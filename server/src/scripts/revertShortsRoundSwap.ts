/**
 * One-off: reverse the earlier swapShortsRounds.ts so "Make Time Visible" is
 * the LIVE launch-week round (2026-08-03) and "Memory Match" becomes the past
 * round (2026-07-27).
 *
 *   memory-match-2026-08-03      -> memory-match-2026-07-27      (-7d stamps)
 *   make-time-visible-2026-07-27 -> make-time-visible-2026-08-03 (+7d stamps)
 *
 * Differences from the original swap: the 07-27 round now also contains REAL
 * data from tonight's testing (2 submissions, 10 votes, 2 vote rounds, all
 * stamped 2026-08-02T23:xx). Those move with the challenge but get +1h (not
 * +7d) so they land just after the Aug 3 UTC rollover instead of in the
 * future. Seeded docs (stamped before Aug 1) get the symmetric ±7d shift.
 * Also expires any still-active build sessions on 2026-08-03 so nobody
 * resumes a stale Memory Match session inside the swapped-in challenge.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/revertShortsRoundSwap.ts            # dry run
 *   npx tsx --env-file=config.env src/scripts/revertShortsRoundSwap.ts --apply    # write
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { getPlayChallengeModel } from "../models/shorts/challenge.js";
import { getPlayVoteModel, getPlayVoteRoundModel } from "../models/shorts/vote.js";
import { getPlayBuildSessionModel } from "../models/shorts/buildSession.js";

const APPLY = process.argv.includes("--apply");

const MEM_OLD = { slug: "memory-match-2026-08-03", date: "2026-08-03" };
const MEM_NEW = { slug: "memory-match-2026-07-27", date: "2026-07-27" };
const MTV_OLD = { slug: "make-time-visible-2026-07-27", date: "2026-07-27" };
const MTV_NEW = { slug: "make-time-visible-2026-08-03", date: "2026-08-03" };
const TEMP_DATE = "2099-01-01";
const DAY7 = { unit: "day" as const, amount: 7 };
const HOUR1 = { unit: "hour" as const, amount: 1 };
// Anything stamped before this is seeded launch data; at/after is tonight's real testing.
const REAL_CUTOFF = new Date("2026-08-01T00:00:00Z");

async function main() {
  await connectPlayMongoose();
  const Sub = getPlaySubmissionModel();
  const Challenge = getPlayChallengeModel();
  const Vote = getPlayVoteModel();
  const VoteRound = getPlayVoteRoundModel();
  const Sess = getPlayBuildSessionModel();

  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const memSubs = await Sub.countDocuments({ challengeSlug: MEM_OLD.slug });
  const mtvSeededSubs = await Sub.countDocuments({
    challengeSlug: MTV_OLD.slug,
    submittedAt: { $lt: REAL_CUTOFF },
  });
  const mtvRealSubs = await Sub.countDocuments({
    challengeSlug: MTV_OLD.slug,
    submittedAt: { $gte: REAL_CUTOFF },
  });
  const memVotes = await Vote.countDocuments({ challengeDate: MEM_OLD.date });
  const mtvSeededVotes = await Vote.countDocuments({
    challengeDate: MTV_OLD.date,
    createdAt: { $lt: REAL_CUTOFF },
  });
  const mtvRealVotes = await Vote.countDocuments({
    challengeDate: MTV_OLD.date,
    createdAt: { $gte: REAL_CUTOFF },
  });
  const mtvVoteRounds = await VoteRound.countDocuments({ challengeDate: MTV_OLD.date });
  const activeSess = await Sess.countDocuments({
    challengeDate: MEM_OLD.date,
    status: { $in: ["provisioning", "active"] },
  });
  console.log(`memory-match: ${memSubs} subs, ${memVotes} votes  ->  ${MEM_NEW.date}`);
  console.log(
    `make-time-visible: ${mtvSeededSubs} seeded + ${mtvRealSubs} real subs, ` +
      `${mtvSeededVotes} seeded + ${mtvRealVotes} real votes, ${mtvVoteRounds} vote rounds  ->  ${MTV_NEW.date}`,
  );
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

  // submissions (distinguishable by slug; real vs seeded by submittedAt)
  const s1 = await Sub.updateMany(
    { challengeSlug: MEM_OLD.slug },
    [{
      $set: {
        challengeSlug: MEM_NEW.slug,
        challengeDate: MEM_NEW.date,
        submittedAt: { $dateSubtract: { startDate: "$submittedAt", ...DAY7 } },
        createdAt: { $dateSubtract: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateSubtract: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const s2 = await Sub.updateMany(
    { challengeSlug: MTV_OLD.slug, submittedAt: { $lt: REAL_CUTOFF } },
    [{
      $set: {
        challengeSlug: MTV_NEW.slug,
        challengeDate: MTV_NEW.date,
        submittedAt: { $dateAdd: { startDate: "$submittedAt", ...DAY7 } },
        createdAt: { $dateAdd: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const s3 = await Sub.updateMany(
    { challengeSlug: MTV_OLD.slug },
    [{
      $set: {
        challengeSlug: MTV_NEW.slug,
        challengeDate: MTV_NEW.date,
        submittedAt: { $dateAdd: { startDate: "$submittedAt", ...HOUR1 } },
        createdAt: { $dateAdd: { startDate: "$createdAt", ...HOUR1 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...HOUR1 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  console.log(
    `✓ submissions: ${s1.modifiedCount} -> ${MEM_NEW.date}, ` +
      `${s2.modifiedCount} seeded + ${s3.modifiedCount} real -> ${MTV_NEW.date}`,
  );

  // votes (only challengeDate distinguishes the sets -> hop through temp)
  await Vote.updateMany(
    { challengeDate: MEM_OLD.date },
    [{
      $set: {
        challengeDate: TEMP_DATE,
        createdAt: { $dateSubtract: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateSubtract: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const v2 = await Vote.updateMany(
    { challengeDate: MTV_OLD.date, createdAt: { $lt: REAL_CUTOFF } },
    [{
      $set: {
        challengeDate: MTV_NEW.date,
        createdAt: { $dateAdd: { startDate: "$createdAt", ...DAY7 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...DAY7 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const v3 = await Vote.updateMany(
    { challengeDate: MTV_OLD.date },
    [{
      $set: {
        challengeDate: MTV_NEW.date,
        createdAt: { $dateAdd: { startDate: "$createdAt", ...HOUR1 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...HOUR1 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  const v1 = await Vote.updateMany(
    { challengeDate: TEMP_DATE },
    [{ $set: { challengeDate: MEM_NEW.date } }],
    { timestamps: false, updatePipeline: true },
  );
  console.log(
    `✓ votes: ${v1.modifiedCount} -> ${MEM_NEW.date}, ` +
      `${v2.modifiedCount} seeded + ${v3.modifiedCount} real -> ${MTV_NEW.date}`,
  );

  // vote rounds (only tonight's real testing has any; no seeded vote rounds exist)
  const vr = await VoteRound.updateMany(
    { challengeDate: MTV_OLD.date },
    [{
      $set: {
        challengeDate: MTV_NEW.date,
        createdAt: { $dateAdd: { startDate: "$createdAt", ...HOUR1 } },
        updatedAt: { $dateAdd: { startDate: "$updatedAt", ...HOUR1 } },
      },
    }],
    { timestamps: false, updatePipeline: true },
  );
  console.log(`✓ vote rounds: ${vr.modifiedCount} -> ${MTV_NEW.date}`);

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
