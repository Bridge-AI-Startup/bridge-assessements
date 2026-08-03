/**
 * One-off: move the seeded launch round from 2026-08-03 onto the current week
 * (2026-07-27) so it is live immediately, and remove the empty todo-list test
 * round that previously occupied that week.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/moveShortsLaunchRound.ts            # dry run
 *   npx tsx --env-file=config.env src/scripts/moveShortsLaunchRound.ts --apply    # write
 *
 * All submittedAt/createdAt/updatedAt stamps shift back exactly 7 days, so the
 * relative ordering of submissions and votes is preserved and previewRevision
 * (derived from submittedAt) stays coherent.
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { getPlayChallengeModel } from "../models/shorts/challenge.js";
import { getPlayVoteModel } from "../models/shorts/vote.js";

const FROM_DATE = "2026-08-03";
const TO_DATE = "2026-07-27";
const FROM_SLUG = "memory-match-2026-08-03";
const TO_SLUG = "memory-match-2026-07-27";
const DISPLACED_SLUG = "todo-list-2026-07-27";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectPlayMongoose();
  const Submission = getPlaySubmissionModel();
  const Challenge = getPlayChallengeModel();
  const Vote = getPlayVoteModel();

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const displaced = await Challenge.findOne({ slug: DISPLACED_SLUG }).lean();
  const displacedSubs = displaced
    ? await Submission.countDocuments({ challengeSlug: DISPLACED_SLUG })
    : 0;
  console.log(
    `1. ${DISPLACED_SLUG}: ${displaced ? "delete" : "already gone"}` +
      (displaced ? ` (${displacedSubs} submissions attached — must be 0)` : ""),
  );
  if (displaced && displacedSubs > 0) {
    throw new Error(`refusing: ${DISPLACED_SLUG} still has submissions`);
  }

  const challenge =
    (await Challenge.findOne({ slug: FROM_SLUG }).lean()) ??
    (await Challenge.findOne({ slug: TO_SLUG }).lean()); // idempotent re-run
  const subs = await Submission.find({ challengeDate: FROM_DATE })
    .select("_id displayName submittedAt")
    .lean();
  const votes = await Vote.countDocuments({ challengeDate: FROM_DATE });
  console.log(
    `2. move ${FROM_SLUG} -> ${TO_SLUG} (${FROM_DATE} -> ${TO_DATE}); challenge ${challenge ? "found" : "MISSING"}`,
  );
  console.log(`3. re-date ${subs.length} submissions and ${votes} votes back 7 days`);
  for (const s of subs) {
    const to = new Date(new Date(s.submittedAt as Date).getTime() - WEEK_MS);
    console.log(`     - ${String(s.displayName).padEnd(11)} ${new Date(s.submittedAt as Date).toISOString()} -> ${to.toISOString()}`);
  }

  if (!APPLY) {
    console.log("Dry run complete — nothing written.");
    process.exit(0);
  }

  if (displaced) {
    await Challenge.deleteOne({ slug: DISPLACED_SLUG });
    console.log(`   ✓ deleted ${DISPLACED_SLUG}`);
  }

  await Challenge.updateOne(
    { slug: FROM_SLUG },
    { $set: { slug: TO_SLUG, challengeDate: TO_DATE } },
    { timestamps: false },
  );
  console.log("   ✓ challenge moved");

  const subRes = await Submission.updateMany(
    { challengeDate: FROM_DATE },
    [
      {
        $set: {
          challengeDate: TO_DATE,
          challengeSlug: TO_SLUG,
          submittedAt: { $dateSubtract: { startDate: "$submittedAt", unit: "day", amount: 7 } },
          createdAt: { $dateSubtract: { startDate: "$createdAt", unit: "day", amount: 7 } },
          updatedAt: { $dateSubtract: { startDate: "$updatedAt", unit: "day", amount: 7 } },
        },
      },
    ],
    { timestamps: false, updatePipeline: true },
  );
  console.log(`   ✓ submissions updated: ${subRes.modifiedCount}`);

  const voteRes = await Vote.updateMany(
    { challengeDate: FROM_DATE },
    [
      {
        $set: {
          challengeDate: TO_DATE,
          createdAt: { $dateSubtract: { startDate: "$createdAt", unit: "day", amount: 7 } },
          updatedAt: { $dateSubtract: { startDate: "$updatedAt", unit: "day", amount: 7 } },
        },
      },
    ],
    { timestamps: false, updatePipeline: true },
  );
  console.log(`   ✓ votes updated: ${voteRes.modifiedCount}`);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
