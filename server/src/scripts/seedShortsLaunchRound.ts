/**
 * Cold-start seed for a Shorts round: challenge + hand-authored builds +
 * a simulated pairwise vote graph run through the real TrueSkill updater.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedShortsLaunchRound.ts --date=2026-08-03            # dry run
 *   npx tsx --env-file=config.env src/scripts/seedShortsLaunchRound.ts --date=2026-08-03 --apply    # write
 *
 * Round config lives in shorts/seed-builds/<date>/seed.json:
 *   {
 *     "challengeSlug":  "make-time-visible-2026-08-03",
 *     "challengeJson":  "shorts/challenges/make-time-visible-2026-08-03.json",
 *     "cleanupTestData": false,      // week-1 only: prune legacy test/dummy rows
 *     "votesPerVoter":  5,
 *     "randomSeed":     20260810,    // deterministic vote graph
 *     "builds": [ { "dir", "name", "anonymousId", "minutes", "strength" }, ... ]
 *   }
 *
 * `strength` is a hidden win-propensity used ONLY to simulate votes; every
 * stored rating is genuine output of services/shorts/bayesianRating.ts.
 *
 * Seeded anonymousIds are UUID-shaped so they read naturally in the gallery.
 * The ONLY record of which rows are seeded is seed.json plus the manifest.json
 * written next to it on apply — keep both to be able to remove the data later.
 */

import "../config/loadEnv.js";
import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import { fileURLToPath } from "url";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { getPlayChallengeModel } from "../models/shorts/challenge.js";
import { getPlayVoteModel, getPlayVoteRoundModel } from "../models/shorts/vote.js";
import {
  updateRatings1v1,
  rankingScoreFrom,
  pairKeyFor,
  INITIAL_RATING_MEAN,
  INITIAL_RATING_DEVIATION,
} from "../services/shorts/bayesianRating.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");

type SeedBuild = {
  dir: string;
  name: string;
  anonymousId: string;
  /** submittedAt = period open + this many minutes */
  minutes: number;
  /** hidden win propensity for the simulated vote graph (0..1) */
  strength: number;
};

type SeedConfig = {
  challengeSlug: string;
  challengeJson: string;
  cleanupTestData?: boolean;
  votesPerVoter?: number;
  randomSeed: number;
  builds: SeedBuild[];
};

const APPLY = process.argv.includes("--apply");
const dateArg = process.argv.find((a) => a.startsWith("--date="));
if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg.slice(7))) {
  console.error("Usage: seedShortsLaunchRound.ts --date=YYYY-MM-DD [--apply]");
  process.exit(1);
}
const CHALLENGE_DATE = dateArg.slice(7);
const BUILDS_DIR = path.join(REPO, "shorts/seed-builds", CHALLENGE_DATE);
const CONFIG_PATH = path.join(BUILDS_DIR, "seed.json");

/** Deterministic PRNG so re-runs reproduce the same vote graph. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("No seed config at", CONFIG_PATH);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as SeedConfig;
  const VOTES_PER_VOTER = cfg.votesPerVoter ?? 5;
  const OPEN = Date.parse(`${CHALLENGE_DATE}T00:00:00.000Z`);
  const at = (mins: number) => new Date(OPEN + mins * 60_000);

  await connectPlayMongoose();
  const Submission = getPlaySubmissionModel();
  const Challenge = getPlayChallengeModel();
  const Vote = getPlayVoteModel();
  const VoteRound = getPlayVoteRoundModel();

  log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");
  log(`round: ${cfg.challengeSlug} (${CHALLENGE_DATE}), ${cfg.builds.length} builds`);
  log("");

  /* ---------------------------------------------------------------- 1. clean */

  if (cfg.cleanupTestData) {
    const staleFilter = {
      $or: [
        { challengeDate: "2026-07-27" },
        { anonymousId: { $regex: "^dummy-" } },
        { anonymousId: { $regex: "^(submit-)?smoke" } },
        { anonymousId: { $regex: "^qa-" } },
      ],
    };
    const stale = await Submission.find(staleFilter)
      .select("_id displayName challengeDate anonymousId")
      .lean();
    log(`1. cleanup — ${stale.length} submissions match the test/dummy filter`);
    const staleIds = stale.map((s) => new Types.ObjectId(String(s._id)));
    const orphanVotes = await Vote.find({
      $or: [{ winnerId: { $in: staleIds } }, { loserId: { $in: staleIds } }],
    }).select("_id").lean();
    const staleRounds = await VoteRound.find({
      challengeDate: { $in: ["2026-07-27", "2026-07-20", "2026-07-10"] },
    }).select("_id").lean();
    log(`   ${orphanVotes.length} orphaned votes, ${staleRounds.length} stale vote rounds`);
    if (APPLY) {
      await Vote.deleteMany({ _id: { $in: orphanVotes.map((v) => v._id) } });
      await VoteRound.deleteMany({ _id: { $in: staleRounds.map((r) => r._id) } });
      await Submission.deleteMany({ _id: { $in: staleIds } });
      log("   ✓ deleted");
    }
  } else {
    log("1. cleanup — skipped (cleanupTestData not set)");
  }
  log("");

  /* ------------------------------------------------------------ 2. challenge */

  const challengePayload = JSON.parse(
    fs.readFileSync(path.join(REPO, cfg.challengeJson), "utf8"),
  );
  log(
    `2. challenge — upsert ${challengePayload.slug} (${challengePayload.challengeDate}, ` +
      `${challengePayload.status}, makeMode=${challengePayload.makeMode})`,
  );
  if (APPLY) {
    await Challenge.findOneAndUpdate(
      { slug: challengePayload.slug },
      { $set: challengePayload },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    log("   ✓ upserted");
  }
  log("");

  /* ----------------------------------------------------------- 3. submissions */

  const existing = await Submission.countDocuments({ challengeDate: CHALLENGE_DATE });
  if (existing > 0) {
    console.error(
      `Refusing: ${existing} submissions already exist for ${CHALLENGE_DATE}. ` +
        "Delete them first if you intend to re-seed.",
    );
    process.exit(1);
  }

  log(`3. submissions — ${cfg.builds.length} builds from ${path.relative(REPO, BUILDS_DIR)}`);
  const docs = cfg.builds.map((b) => {
    const content = fs.readFileSync(path.join(BUILDS_DIR, b.dir, "index.html"), "utf8");
    return {
      _id: new Types.ObjectId(),
      anonymousId: b.anonymousId,
      displayName: b.name,
      challengeSlug: cfg.challengeSlug,
      challengeDate: CHALLENGE_DATE,
      sessionId: new Types.ObjectId(),
      files: [{ path: "index.html", content }],
      fileCount: 1,
      totalBytes: Buffer.byteLength(content, "utf8"),
      submittedAt: at(b.minutes),
      ratingMean: INITIAL_RATING_MEAN,
      ratingDeviation: INITIAL_RATING_DEVIATION,
      rankingScore: rankingScoreFrom(INITIAL_RATING_MEAN, INITIAL_RATING_DEVIATION),
      wins: 0,
      losses: 0,
      matches: 0,
      strength: b.strength,
      dir: b.dir,
    };
  });
  for (const d of docs) {
    log(
      `     - ${d.displayName.padEnd(11)} ${d.dir.padEnd(19)} ` +
        `${(d.totalBytes / 1024).toFixed(1)} KB  @ ${d.submittedAt.toISOString()}`,
    );
  }
  log("");

  /* ----------------------------------------------------- 4. simulate the vote */

  const rand = mulberry32(cfg.randomSeed);
  const state = new Map(
    docs.map((d) => [
      String(d._id),
      { ratingMean: d.ratingMean, ratingDeviation: d.ratingDeviation, wins: 0, losses: 0, matches: 0 },
    ]),
  );

  const votes: {
    anonymousId: string; challengeDate: string;
    winnerId: Types.ObjectId; loserId: Types.ObjectId; pairKey: string; createdAt: Date;
  }[] = [];

  // first vote lands after the last submission so no vote predates its builds
  let stamp = Math.max(...cfg.builds.map((b) => b.minutes)) + 9;

  for (const voter of docs) {
    const seenPairs = new Set<string>();
    const others = docs.filter((d) => d.anonymousId !== voter.anonymousId);

    for (let n = 0; n < VOTES_PER_VOTER; n++) {
      let a = others[Math.floor(rand() * others.length)];
      let b = others[Math.floor(rand() * others.length)];
      let guard = 0;
      while ((a === b || seenPairs.has(pairKeyFor(String(a._id), String(b._id)))) && guard++ < 60) {
        a = others[Math.floor(rand() * others.length)];
        b = others[Math.floor(rand() * others.length)];
      }
      if (a === b) continue;
      const key = pairKeyFor(String(a._id), String(b._id));
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      const pA = a.strength / (a.strength + b.strength);
      const [win, lose] = rand() < pA ? [a, b] : [b, a];

      const ws = state.get(String(win._id))!;
      const ls = state.get(String(lose._id))!;
      const next = updateRatings1v1(
        { ratingMean: ws.ratingMean, ratingDeviation: ws.ratingDeviation },
        { ratingMean: ls.ratingMean, ratingDeviation: ls.ratingDeviation },
      );
      ws.ratingMean = next.winner.ratingMean;
      ws.ratingDeviation = next.winner.ratingDeviation;
      ls.ratingMean = next.loser.ratingMean;
      ls.ratingDeviation = next.loser.ratingDeviation;
      ws.wins++; ws.matches++;
      ls.losses++; ls.matches++;

      stamp += 3 + Math.floor(rand() * 22);
      votes.push({
        anonymousId: voter.anonymousId,
        challengeDate: CHALLENGE_DATE,
        winnerId: win._id,
        loserId: lose._id,
        pairKey: key,
        createdAt: at(stamp),
      });
    }
  }

  const ranked = docs
    .map((d) => {
      const s = state.get(String(d._id))!;
      return { ...d, ...s, rankingScore: rankingScoreFrom(s.ratingMean, s.ratingDeviation) };
    })
    .sort((x, y) => y.rankingScore - x.rankingScore);

  log(`4. ratings — ${votes.length} simulated votes through the real TrueSkill update`);
  log("   rank  builder      W–L   μ      σ     μ−3σ");
  ranked.forEach((r, i) => {
    log(
      `   ${String(i + 1).padStart(2)}    ${r.displayName.padEnd(11)} ` +
        `${String(r.wins).padStart(2)}–${String(r.losses).padEnd(2)} ` +
        `${r.ratingMean.toFixed(2).padStart(6)} ${r.ratingDeviation.toFixed(2).padStart(5)} ` +
        `${r.rankingScore.toFixed(2).padStart(6)}`,
    );
  });
  log("");

  if (!APPLY) {
    log("Dry run complete — nothing written. Re-run with --apply to commit.");
    process.exit(0);
  }

  await Submission.insertMany(
    ranked.map((r) => ({
      _id: r._id,
      anonymousId: r.anonymousId,
      displayName: r.displayName,
      challengeSlug: r.challengeSlug,
      challengeDate: r.challengeDate,
      sessionId: r.sessionId,
      files: r.files,
      fileCount: r.fileCount,
      totalBytes: r.totalBytes,
      submittedAt: r.submittedAt,
      ratingMean: r.ratingMean,
      ratingDeviation: r.ratingDeviation,
      rankingScore: r.rankingScore,
      wins: r.wins,
      losses: r.losses,
      matches: r.matches,
      createdAt: r.submittedAt,
      updatedAt: r.submittedAt,
    })),
    // timestamps:false so the explicit createdAt survives insertMany
    { ordered: true, timestamps: false },
  );
  log(`   ✓ inserted ${ranked.length} submissions`);

  await Vote.insertMany(
    votes.map((v) => ({ ...v, updatedAt: v.createdAt })),
    { ordered: true, timestamps: false },
  );
  log(`   ✓ inserted ${votes.length} votes`);

  const manifest = {
    note: "Seeded cold-start data. These anonymousIds are synthetic, not real users.",
    challengeDate: CHALLENGE_DATE,
    challengeSlug: cfg.challengeSlug,
    submissions: ranked.map((r) => ({
      _id: String(r._id),
      anonymousId: r.anonymousId,
      displayName: r.displayName,
      dir: r.dir,
    })),
    voteCount: votes.length,
  };
  const manifestPath = path.join(BUILDS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log(`   ✓ wrote ${path.relative(REPO, manifestPath)}`);
  log("");
  log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
