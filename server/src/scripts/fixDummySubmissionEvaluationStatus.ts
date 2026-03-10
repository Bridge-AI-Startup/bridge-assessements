/**
 * One-off: set evaluationStatus + minimal evaluationReport on submitted dummy
 * submissions so the dashboard stops showing "Evaluating...". Run from server dir:
 *   npx tsx src/scripts/fixDummySubmissionEvaluationStatus.ts
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import SubmissionModel from "../models/submission.js";

// Distinct scores per dummy so the dashboard doesn’t show the same number
const SCORES = [5, 6, 7, 8, 9, 10];

function minimalReport(score: number) {
  return {
    session_summary: "Demo submission.",
    criteria_results: [
      {
        criterion: "Tests and debugs",
        score,
        confidence: score >= 8 ? "high" : score >= 6 ? "medium" : "low",
        verdict: score >= 8 ? "Strong test coverage." : score >= 6 ? "Added tests." : "Limited testing.",
        evaluable: true,
        evidence: [{ ts: 60, ts_end: 120, observation: "Ran npm test." }],
      },
    ],
  };
}

async function main() {
  await connectMongoose();

  const dummies = await SubmissionModel.find({
    status: "submitted",
    candidateEmail: { $nin: ["saaz@bridge.com", "quinn.davis@example.com"] },
  })
    .lean()
    .exec();

  let updated = 0;
  for (let i = 0; i < dummies.length; i++) {
    const score = SCORES[i % SCORES.length];
    await SubmissionModel.updateOne(
      { _id: dummies[i]._id },
      {
        $set: {
          evaluationStatus: "completed",
          evaluationError: null,
          evaluationReport: minimalReport(score),
        },
      }
    );
    updated++;
  }

  const r3 = await SubmissionModel.updateMany(
    { candidateEmail: "quinn.davis@example.com", status: "submitted" },
    {
      $set: {
        evaluationStatus: "failed",
        evaluationError: "Repo indexing timed out",
      },
    }
  );

  console.log("Updated (completed + varied scores):", updated);
  console.log("Updated (failed, Quinn):", r3.modifiedCount);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
