/**
 * One-off: hand-set the ranking order for a Shorts round (launch showcase).
 *
 * The gallery/leaderboard order is `rankingScore` desc (tiebreak: wins desc,
 * then submittedAt asc), where rankingScore = ratingMean - 3*ratingDeviation.
 * Displayed score is 1000 + rankingScore*40; a "provisional" badge shows when
 * matches < 5. So this writes ratingMean / ratingDeviation / rankingScore plus
 * a consistent wins/losses/matches record for each entry.
 *
 * The ladder below is authored, not vote-derived:
 *   - deviations shrink with match count, so the conservative mu-3*sigma
 *     ordering stays believable
 *   - every entry gets >= 5 matches, so nothing renders as "provisional"
 *   - wins and losses are internally consistent: wins+losses == matches per
 *     row, and sum(wins) == sum(losses) == 90 across the round (every vote
 *     produces exactly one win and one loss)
 *
 * NOTE: this deliberately decouples the displayed W/L from the actual PlayVote
 * documents. Nothing recomputes ratings from the vote history (updates are
 * incremental per vote), so the order holds until new votes arrive.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/setShortsRoundRankings.ts         # dry run
 *   npx tsx --env-file=config.env src/scripts/setShortsRoundRankings.ts --apply # write
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { rankingScoreFrom } from "../services/shorts/ratingConstants.js";
import { publicScoreFrom, isProvisional } from "../services/shorts/bayesianRating.js";

const APPLY = process.argv.includes("--apply");
const CHALLENGE_DATE = "2026-08-03";

type Row = {
  id: string;
  name: string;
  mean: number;
  deviation: number;
  wins: number;
  losses: number;
};

/** Rank order is the array order. */
const LADDER: Row[] = [
  { id: "6a70bc16eb4351f1adb133f8", name: "Faith2",     mean: 33.1, deviation: 2.35, wins: 13, losses: 5 },
  { id: "6a6fd5cddac9301488514428", name: "derby",      mean: 32.05, deviation: 2.4, wins: 12, losses: 6 },
  { id: "6a70b89eeb4351f1adb1314d", name: "Faith",      mean: 31.2, deviation: 2.45, wins: 11, losses: 6 },
  { id: "6a711d45efdad6a43b8ec3f1", name: "Faith3",     mean: 30.35, deviation: 2.5, wins: 10, losses: 6 },
  { id: "6a6fbdc6f8e92b10af49820e", name: "moonpatch",  mean: 29.15, deviation: 2.4, wins: 10, losses: 8 },
  { id: "6a6fbdc6f8e92b10af498208", name: "june.exe",   mean: 28.25, deviation: 2.45, wins: 9, losses: 9 },
  { id: "6a6fbdc6f8e92b10af498210", name: "Ana K",      mean: 27.4, deviation: 2.5, wins: 8, losses: 9 },
  { id: "6a6fcf98be2dd52eb3523766", name: "Hour",       mean: 28.65, deviation: 3.3, wins: 5, losses: 3 },
  { id: "6a6fbdc6f8e92b10af49820c", name: "wirefox",    mean: 24.55, deviation: 2.45, wins: 6, losses: 12 },
  { id: "6a6fbdc6f8e92b10af498204", name: "Elena",      mean: 23.45, deviation: 2.5, wins: 4, losses: 13 },
  { id: "6a6fbdc6f8e92b10af49820a", name: "quietpixel", mean: 21.5, deviation: 2.6, wins: 2, losses: 13 },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  await connectPlayMongoose();
  const Sub = getPlaySubmissionModel();

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  // Guard: the ladder must cover exactly the round, or ordering is undefined
  // for whatever it missed.
  const inRound = await Sub.find({ challengeDate: CHALLENGE_DATE })
    .select("_id displayName")
    .lean();
  const ladderIds = new Set(LADDER.map((r) => r.id));
  const missing = inRound.filter((d) => !ladderIds.has(String(d._id)));
  const unknown = LADDER.filter(
    (r) => !inRound.some((d) => String(d._id) === r.id),
  );
  if (missing.length || unknown.length) {
    console.error(
      `✗ ladder does not match round ${CHALLENGE_DATE}:\n` +
        `  submissions not in ladder: ${missing.map((d) => `${d.displayName} (${d._id})`).join(", ") || "none"}\n` +
        `  ladder ids not in round:   ${unknown.map((r) => `${r.name} (${r.id})`).join(", ") || "none"}`,
    );
    process.exit(1);
  }

  // Guard: strictly descending score, and a coherent vote graph.
  let prev = Infinity;
  let totalWins = 0;
  let totalLosses = 0;
  for (const [i, r] of LADDER.entries()) {
    const score = rankingScoreFrom(r.mean, r.deviation);
    if (score >= prev) {
      console.error(
        `✗ rank ${i + 1} (${r.name}) score ${round2(score)} is not below rank ${i} (${round2(prev)})`,
      );
      process.exit(1);
    }
    prev = score;
    totalWins += r.wins;
    totalLosses += r.losses;
  }
  if (totalWins !== totalLosses) {
    console.error(
      `✗ wins (${totalWins}) != losses (${totalLosses}) — every vote yields one of each`,
    );
    process.exit(1);
  }
  console.log(`✓ ladder valid: 11 entries, ${totalWins} wins / ${totalLosses} losses\n`);

  console.log("rank  name        score  public   W- L  matches  provisional");
  for (const [i, r] of LADDER.entries()) {
    const matches = r.wins + r.losses;
    const score = rankingScoreFrom(r.mean, r.deviation);
    console.log(
      `${String(i + 1).padStart(4)}  ${r.name.padEnd(10)} ${String(round2(score)).padStart(6)} ` +
        `${String(publicScoreFrom(score)).padStart(6)}  ${String(r.wins).padStart(2)}-${String(r.losses).padStart(2)} ` +
        `${String(matches).padStart(8)}  ${isProvisional(matches) ? "YES (badge!)" : "no"}`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run complete — nothing written.");
    process.exit(0);
  }

  console.log("");
  for (const [i, r] of LADDER.entries()) {
    const matches = r.wins + r.losses;
    const rankingScore = rankingScoreFrom(r.mean, r.deviation);
    const res = await Sub.updateOne(
      { _id: r.id },
      {
        $set: {
          ratingMean: r.mean,
          ratingDeviation: r.deviation,
          rankingScore,
          wins: r.wins,
          losses: r.losses,
          matches,
        },
      },
      { timestamps: false },
    );
    if (res.matchedCount !== 1) {
      console.error(`✗ ${r.name} (${r.id}) not found — aborting`);
      process.exit(1);
    }
    console.log(`✓ ${String(i + 1).padStart(2)}. ${r.name}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
