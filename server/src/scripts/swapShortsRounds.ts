/**
 * One-off: swap the two seeded rounds so "Make Time Visible" is live NOW and
 * "Memory Match" becomes next week's round.
 *
 *   memory-match-2026-07-27      -> memory-match-2026-08-03      (+7d stamps)
 *   make-time-visible-2026-08-03 -> make-time-visible-2026-07-27 (-7d stamps)
 *
 * Votes carry only challengeDate, so they hop through a temp date to avoid the
 * two sets merging mid-swap. Also expires any still-active build sessions on
 * 2026-07-27 (leftover internal test sessions for the old todo-list round) so
 * nobody resumes a stale session inside the swapped-in challenge.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/swapShortsRounds.ts            # dry run
 *   npx tsx --env-file=config.env src/scripts/swapShortsRounds.ts --apply    # write
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { getPlayChallengeModel } from "../models/shorts/challenge.js";
import { getPlayVoteModel } from "../models/shorts/vote.js";
import { getPlayBuildSessionModel } from "../models/shorts/buildSession.js";

const APPLY = process.argv.includes("--apply");

const MEM_OLD = { slug: "memory-match-2026-07-27", date: "2026-07-27" };
const MEM_NEW = { slug: "memory-match-2026-08-03", date: "2026-08-03" };
const MTV_OLD = { slug: "make-time-visible-2026-08-03", date: "2026-08-03" };
const MTV_NEW = { slug: "make-time-visible-2026-07-27", date: "2026-07-27" };
const TEMP_DATE = "2099-01-01";
const DAY7 = { unit: "day" as const, amount: 7 };

async function main() {
  await connectPlayMongoose();
  const Sub = getPlaySubmissionModel();
  const Challenge = getPlayChallengeModel();
  const Vote = getPlayVoteModel();
  const Sess = getPlayBuildSessionModel();

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const memSubs = await Sub.countDocuments({ challengeSlug: MEM_OLD.slug });
  const mtvSubs = await Sub.countDocuments({ challengeSlug: MTV_OLD.slug });
  const memVotes = await Vote.countDocuments({ challengeDate: MEM_OLD.date });
  const mtvVotes = await Vote.countDocuments({ challengeDate: MTV_OLD.date });
  const activeSess = await Sess.countDocuments({
    challengeDate: MEM_OLD.date,
    status: { $in: ["provisioning", "active"] },
  });
  console.log(`memory-match: ${memSubs} subs, ${memVotes} votes  ->  ${MEM_NEW.date}`);
  console.log(`make-time-visible: ${mtvSubs} subs, ${mtvVotes} votes  ->  ${MTV_NEW.date}`);
  console.log(`active build sessions on ${MEM_OLD.date} to expire: ${activeSess}`);

  if (!APPLY) {
    console.log("Dry run complete — nothing written.");
    process.exit(0);
  }

  // challenges (unique challengeDate index -> hop through temp)
  await Challenge.updateOne({ slug: MEM_OLD.slug }, { $set: { challengeDate: TEMP_DATE } }, { timestamps: false });
  await Challenge.updateOne(
    { slug: MTV_OLD.slug },
    { $set: { slug: MTV_NEW.slug, challengeDate: MTV_NEW.date } },
    { timestamps: false },
  );
  await Challenge.updateOne(
    { slug: MEM_OLD.slug },
    { $set: { slug: MEM_NEW.slug, challengeDate: MEM_NEW.date } },
    { timestamps: false },
  );
  console.log("✓ challenges swapped");

  // submissions (distinguishable by slug)
  const s1 = await Sub.updateMany(
    { challengeSlug: MEM_OLD.slug },
    [{
      $set: {
        challengeSlug: MEM_NEW.slug,
        challengeDate: MEM_NEW.date,
        submittedAt: { $dateAdd: { startDate: "$submittedAt", ...DAY7 } },
        createdAt: { $dateAdd: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const s2 = await Sub.updateMany(
    { challengeSlug: MTV_OLD.slug },
    [{
      $set: {
        challengeSlug: MTV_NEW.slug,
        challengeDate: MTV_NEW.date,
        submittedAt: { $dateSubtract: { startDate: "$submittedAt", ...DAY7 } },
        createdAt: { $dateSubtract: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateSubtract: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  console.log(`✓ submissions: ${s1.modifiedCount} -> ${MEM_NEW.date}, ${s2.modifiedCount} -> ${MTV_NEW.date}`);

  // votes (only challengeDate distinguishes them -> hop through temp)
  await Vote.updateMany(
    { challengeDate: MEM_OLD.date },
    [{
      $set: {
        challengeDate: TEMP_DATE,
        createdAt: { $dateAdd: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const v2 = await Vote.updateMany(
    { challengeDate: MTV_OLD.date },
    [{
      $set: {
        challengeDate: MTV_NEW.date,
        createdAt: { $dateSubtract: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateSubtract: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const v1 = await Vote.updateMany(
    { challengeDate: TEMP_DATE },
    [{ $set: { challengeDate: MEM_NEW.date } }],
    { timestamps: false, updatePipeline: true },
  );
  console.log(`✓ votes: ${v1.modifiedCount} -> ${MEM_NEW.date}, ${v2.modifiedCount} -> ${MTV_NEW.date}`);

  const ex = await Sess.updateMany(
    { challengeDate: MEM_OLD.date, status: { $in: ["provisioning", "active"] } },
    { $set: { status: "expired" } },
  );
  console.log(`✓ expired ${ex.modifiedCount} stale build sessions on ${MEM_OLD.date}`);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
