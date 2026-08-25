/**
 * Additive quality bump for a live Shorts round:
 *   1) insert hand-authored builds from shorts/seed-builds/<date>/
 *   2) optionally run LLM "agent voters" that judge real pairs and castVote
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedShortsQualityBump.ts --date=2026-08-03
 *   npx tsx --env-file=config.env src/scripts/seedShortsQualityBump.ts --date=2026-08-03 --apply
 *   npx tsx --env-file=config.env src/scripts/seedShortsQualityBump.ts --date=2026-08-03 --apply --vote
 *   npx tsx --env-file=config.env src/scripts/seedShortsQualityBump.ts --date=2026-08-03 --vote-only --votes-per-voter=10
 */

import "../config/loadEnv.js";
import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import { fileURLToPath } from "url";
import { z } from "zod";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import {
  INITIAL_RATING_DEVIATION,
  INITIAL_RATING_MEAN,
  rankingScoreFrom,
} from "../services/shorts/ratingConstants.js";
import { castVote, getNextVotePair } from "../services/shorts/voting.js";
import { createChatCompletionWithStructuredOutput } from "../services/langchainAI.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");

const APPLY = process.argv.includes("--apply");
const VOTE = process.argv.includes("--vote") || process.argv.includes("--vote-only");
const VOTE_ONLY = process.argv.includes("--vote-only");
const dateArg = process.argv.find((a) => a.startsWith("--date="));
const votesArg = process.argv.find((a) => a.startsWith("--votes-per-voter="));

if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg.slice(7))) {
  console.error(
    "Usage: seedShortsQualityBump.ts --date=YYYY-MM-DD [--apply] [--vote|--vote-only] [--votes-per-voter=N]",
  );
  process.exit(1);
}

const CHALLENGE_DATE = dateArg.slice(7);
const VOTES_PER_VOTER = Math.min(
  Math.max(parseInt(votesArg?.slice("--votes-per-voter=".length) || "12", 10) || 12, 1),
  25,
);
const BUILDS_DIR = path.join(REPO, "shorts/seed-builds", CHALLENGE_DATE);
const CONFIG_PATH = path.join(BUILDS_DIR, "seed.json");

type SeedBuild = {
  dir: string;
  name: string;
  anonymousId: string;
  minutes: number;
};

type SeedConfig = {
  challengeSlug: string;
  challengeDate?: string;
  builds: SeedBuild[];
};

const JudgmentSchema = z.object({
  winner: z.enum(["A", "B"]),
  reason: z.string(),
  aScore: z.number().min(0).max(10),
  bScore: z.number().min(0).max(10),
});

function log(...args: unknown[]) {
  console.log(...args);
}

function truncateHtml(html: string, max = 9000): string {
  if (html.length <= max) return html;
  return html.slice(0, max) + "\n<!-- truncated -->";
}

async function judgePair(input: {
  challengePrompt: string;
  a: { id: string; displayName: string; html: string };
  b: { id: string; displayName: string; html: string };
}): Promise<{ winnerId: string; loserId: string; reason: string }> {
  const { result } = await createChatCompletionWithStructuredOutput(
    "assessment_chat",
    [
      {
        role: "system",
        content: `You are a picky Shorts gallery voter. Challenge:
${input.challengePrompt}

Vote for the build you'd rather leave open on a second monitor.
Judge on: originality (not a boring clock face), whether you can actually tell the real time, craft/polish, motion/atmosphere, and "I'd keep this open" factor.
Ignore display names. Reply with JSON only.`,
      },
      {
        role: "user",
        content: `Build A (${input.a.displayName}):
\`\`\`html
${truncateHtml(input.a.html)}
\`\`\`

Build B (${input.b.displayName}):
\`\`\`html
${truncateHtml(input.b.html)}
\`\`\`

Which would you rather keep open? Score each 0-10 and pick winner A or B.`,
      },
    ],
    JudgmentSchema,
    { temperature: 0.4, maxTokens: 400, model: "gpt-4o-mini" },
  );

  if (result.winner === "A") {
    return { winnerId: input.a.id, loserId: input.b.id, reason: result.reason };
  }
  return { winnerId: input.b.id, loserId: input.a.id, reason: result.reason };
}

async function insertBuilds(cfg: SeedConfig) {
  const Submission = getPlaySubmissionModel();
  const OPEN = Date.parse(`${CHALLENGE_DATE}T00:00:00.000Z`);
  const at = (mins: number) => new Date(OPEN + mins * 60_000);

  log(`Inserting up to ${cfg.builds.length} builds for ${CHALLENGE_DATE}`);
  const inserted: Array<{ id: string; name: string; anonymousId: string; dir: string }> = [];

  for (const b of cfg.builds) {
    const existing = await Submission.findOne({
      challengeDate: CHALLENGE_DATE,
      anonymousId: b.anonymousId,
      displayName: b.name,
    })
      .select("_id")
      .lean();
    if (existing) {
      log(`  skip ${b.name} (already present ${existing._id})`);
      inserted.push({
        id: String(existing._id),
        name: b.name,
        anonymousId: b.anonymousId,
        dir: b.dir,
      });
      continue;
    }

    const htmlPath = path.join(BUILDS_DIR, b.dir, "index.html");
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Missing ${htmlPath}`);
    }
    const content = fs.readFileSync(htmlPath, "utf8");
    const submittedAt = at(b.minutes);
    const doc = {
      anonymousId: b.anonymousId,
      displayName: b.name,
      challengeSlug: cfg.challengeSlug,
      challengeDate: CHALLENGE_DATE,
      sessionId: new Types.ObjectId(),
      files: [{ path: "index.html", content }],
      fileCount: 1,
      totalBytes: Buffer.byteLength(content, "utf8"),
      submittedAt,
      ratingMean: INITIAL_RATING_MEAN,
      ratingDeviation: INITIAL_RATING_DEVIATION,
      rankingScore: rankingScoreFrom(INITIAL_RATING_MEAN, INITIAL_RATING_DEVIATION),
      wins: 0,
      losses: 0,
      matches: 0,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };

    if (!APPLY) {
      log(
        `  dry ${b.name.padEnd(12)} ${b.dir.padEnd(14)} ${(doc.totalBytes / 1024).toFixed(1)} KB`,
      );
      continue;
    }

    const created = await Submission.create(doc);
    log(`  ✓ ${b.name} → ${created._id}`);
    inserted.push({
      id: String(created._id),
      name: b.name,
      anonymousId: b.anonymousId,
      dir: b.dir,
    });
  }

  const manifestPath = path.join(BUILDS_DIR, "manifest-quality-bump.json");
  if (APPLY) {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          note: "Quality-bump seeded builds (synthetic anonymousIds).",
          challengeDate: CHALLENGE_DATE,
          challengeSlug: cfg.challengeSlug,
          submissions: inserted,
        },
        null,
        2,
      ) + "\n",
    );
    log(`  wrote ${path.relative(REPO, manifestPath)}`);
  }
  return inserted;
}

async function runAgentVotes(cfg: SeedConfig) {
  const Submission = getPlaySubmissionModel();
  const challengePrompt =
    "**This round: make time visible.** Build a page that shows the current time — but not with a boring clock face. It must reflect the real current time, live. Vote for the one you'd leave open on a second monitor.";

  const voters = cfg.builds.map((b) => b.anonymousId);
  // Ensure each voter has a submission (required to vote)
  for (const anonymousId of voters) {
    const ok = await Submission.exists({ challengeDate: CHALLENGE_DATE, anonymousId });
    if (!ok) {
      throw new Error(`Voter ${anonymousId} has no submission — insert builds first`);
    }
  }

  log("");
  log(
    `Agent voting — ${voters.length} voters × up to ${VOTES_PER_VOTER} votes (LLM judges each pair)`,
  );
  if (!APPLY && !VOTE_ONLY) {
    log("  dry run: not casting votes (pass --apply with --vote, or --vote-only --apply)");
  }

  let cast = 0;
  let skipped = 0;

  for (const anonymousId of voters) {
    const voterName =
      cfg.builds.find((b) => b.anonymousId === anonymousId)?.name || anonymousId.slice(0, 8);
    log(`  voter ${voterName}`);

    for (let n = 0; n < VOTES_PER_VOTER; n++) {
      const next = await getNextVotePair({
        anonymousId,
        challengeDate: CHALLENGE_DATE,
        includeFiles: true,
      });

      if (!next.pairAvailable || !next.canVote) {
        const reason = next.pairAvailable ? "unknown" : next.reason;
        const message = next.pairAvailable ? "" : next.message;
        log(`    stop: ${reason} — ${message}`);
        break;
      }

      const a = next.left;
      const b = next.right;
      const aHtml =
        a.files?.find((f) => f.path === "index.html")?.content ||
        a.files?.[0]?.content ||
        "";
      const bHtml =
        b.files?.find((f) => f.path === "index.html")?.content ||
        b.files?.[0]?.content ||
        "";

      if (!aHtml || !bHtml) {
        log(`    skip empty files ${a.displayName} vs ${b.displayName}`);
        skipped++;
        break;
      }

      let decision: { winnerId: string; loserId: string; reason: string };
      try {
        decision = await judgePair({
          challengePrompt,
          a: { id: a.id, displayName: a.displayName, html: aHtml },
          b: { id: b.id, displayName: b.displayName, html: bHtml },
        });
      } catch (err) {
        console.error(`    judge failed:`, err);
        skipped++;
        continue;
      }

      const winnerName =
        decision.winnerId === a.id ? a.displayName : b.displayName;
      const loserName =
        decision.winnerId === a.id ? b.displayName : a.displayName;

      if (!APPLY) {
        log(`    dry → ${winnerName} > ${loserName} (${decision.reason.slice(0, 80)})`);
        cast++;
        continue;
      }

      try {
        await castVote({
          anonymousId,
          challengeDate: CHALLENGE_DATE,
          winnerId: decision.winnerId,
          loserId: decision.loserId,
          includeFiles: false,
        });
        cast++;
        log(`    ✓ ${winnerName} > ${loserName} — ${decision.reason.slice(0, 90)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`    vote error: ${msg}`);
        skipped++;
        if (msg.includes("vote_cap") || msg.includes("no_pairs")) break;
      }
    }
  }

  log(`Agent votes cast: ${cast}, skipped/errors: ${skipped}`);
  return cast;
}

async function printLeaderboard() {
  const Submission = getPlaySubmissionModel();
  const rows = await Submission.find({ challengeDate: CHALLENGE_DATE })
    .select("displayName rankingScore wins losses matches anonymousId")
    .sort({ rankingScore: -1, wins: -1, submittedAt: 1 })
    .lean();

  log("");
  log("Leaderboard after run:");
  log("  rank  name              W–L    μ−3σ   matches");
  rows.forEach((r, i) => {
    const seeded = r.anonymousId.startsWith("a1b2c3d4-e5f6-7890");
    log(
      `  ${String(i + 1).padStart(2)}    ${(r.displayName || "?").padEnd(16)} ` +
        `${String(r.wins ?? 0).padStart(2)}–${String(r.losses ?? 0).padEnd(2)}  ` +
        `${Number(r.rankingScore ?? 0).toFixed(2).padStart(6)}  ` +
        `${String(r.matches ?? 0).padStart(3)}${seeded ? "  ← seeded" : ""}`,
    );
  });
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("No seed config at", CONFIG_PATH);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as SeedConfig;

  log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN");
  log(`round ${cfg.challengeSlug} / ${CHALLENGE_DATE}`);
  log(`flags: vote=${VOTE} voteOnly=${VOTE_ONLY} votesPerVoter=${VOTES_PER_VOTER}`);
  log("");

  await connectPlayMongoose();

  if (!VOTE_ONLY) {
    await insertBuilds(cfg);
  }

  if (VOTE) {
    if (!APPLY) {
      log("\nVote requested but --apply not set — judging a sample dry-run only.");
    }
    await runAgentVotes(cfg);
  }

  await printLeaderboard();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
