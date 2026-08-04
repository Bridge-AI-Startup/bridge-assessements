/**
 * One-off: force a chosen order at the top of a round's leaderboard.
 *
 * The leaderboard sorts on `rankingScore` (μ − 3σ), so this writes explicit
 * μ/σ to the named builds — high enough to clear the current #1, spaced one
 * point apart to fix their order among themselves.
 *
 * This is a manual override of a *live* ranking, so read the caveats:
 *   - It does NOT touch `wins` / `losses` / `matches`, so no vote history is
 *     invented. Builds with fewer than 5 matches keep their "provisional" tag.
 *   - It is NOT sticky. Ratings are recomputed on every vote, so the next
 *     head-to-head involving these builds moves them off these numbers.
 *   - Revert values are printed before writing — keep the output.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/reorderShortsSubmissionRatings.ts         # dry run
 *   npx tsx --env-file=config.env src/scripts/reorderShortsSubmissionRatings.ts --apply # write
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { rankingScoreFrom } from "../services/shorts/ratingConstants.js";

const APPLY = process.argv.includes("--apply");

const CHALLENGE_DATE = "2026-08-03";

/** Display names in the order they should appear, first = rank #1. */
const ORDER = ["Faith2", "Faith", "Faith3"];

/** σ for the pinned builds — small, so μ − 3σ stays close to μ. */
const DEVIATION = 2;
/** Ranking score for the first name; each later name drops by 1. */
const TOP_SCORE = 29;

async function main() {
  await connectPlayMongoose();
  const Sub = getPlaySubmissionModel();

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const all = await Sub.find({ challengeDate: CHALLENGE_DATE })
    .sort({ rankingScore: -1 })
    .select({ displayName: 1, ratingMean: 1, ratingDeviation: 1, rankingScore: 1, matches: 1 })
    .lean();

  console.log(`\nBefore (${all.length} builds on ${CHALLENGE_DATE}):`);
  all.forEach((s, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${s.displayName} — score ${s.rankingScore.toFixed(2)} ` +
        `(μ ${s.ratingMean.toFixed(2)}, σ ${s.ratingDeviation.toFixed(2)}, ${s.matches} matches)`,
    );
  });

  const highest = all.length ? all[0].rankingScore : 0;
  if (TOP_SCORE - (ORDER.length - 1) <= highest) {
    console.warn(
      `\nWARNING: TOP_SCORE ${TOP_SCORE} does not clear the current leader (${highest.toFixed(2)}).`,
    );
  }

  const plan: Array<{
    id: string;
    displayName: string;
    mean: number;
    deviation: number;
    score: number;
    revert: { ratingMean: number; ratingDeviation: number; rankingScore: number };
  }> = [];

  for (const [index, name] of ORDER.entries()) {
    const matched = all.filter((s) => s.displayName === name);
    if (matched.length === 0) {
      throw new Error(`No submission named "${name}" on ${CHALLENGE_DATE}`);
    }
    if (matched.length > 1) {
      throw new Error(
        `${matched.length} submissions named "${name}" on ${CHALLENGE_DATE} — names are not unique, edit this script to target ids`,
      );
    }
    const doc = matched[0];
    const score = TOP_SCORE - index;
    const mean = score + 3 * DEVIATION;
    plan.push({
      id: String(doc._id),
      displayName: name,
      mean,
      deviation: DEVIATION,
      score: rankingScoreFrom(mean, DEVIATION),
      revert: {
        ratingMean: doc.ratingMean,
        ratingDeviation: doc.ratingDeviation,
        rankingScore: doc.rankingScore,
      },
    });
  }

  console.log("\nPlan:");
  for (const [i, p] of plan.entries()) {
    console.log(
      `  #${i + 1} ${p.displayName} (${p.id}) — score ${p.revert.rankingScore.toFixed(2)} → ${p.score.toFixed(2)} ` +
        `(μ ${p.mean}, σ ${p.deviation})`,
    );
  }

  console.log("\nRevert values (keep these):");
  console.log(JSON.stringify(plan.map((p) => ({ id: p.id, ...p.revert })), null, 2));

  if (!APPLY) {
    console.log("\nDry run complete — nothing written. Re-run with --apply.");
    process.exit(0);
  }

  for (const p of plan) {
    await Sub.updateOne(
      { _id: p.id },
      {
        $set: {
          ratingMean: p.mean,
          ratingDeviation: p.deviation,
          rankingScore: p.score,
        },
      },
    );
    console.log(`updated ${p.displayName}`);
  }

  const after = await Sub.find({ challengeDate: CHALLENGE_DATE })
    .sort({ rankingScore: -1 })
    .select({ displayName: 1, rankingScore: 1, matches: 1 })
    .lean();
  console.log("\nAfter:");
  after.forEach((s, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${s.displayName} — score ${s.rankingScore.toFixed(2)} (${s.matches} matches)`,
    );
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
