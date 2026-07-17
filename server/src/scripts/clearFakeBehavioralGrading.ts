/**
 * Clear seeded / simulated behavioral grading from submissions.
 * Does not touch proctoring, evaluation reports, or code uploads.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/clearFakeBehavioralGrading.ts
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import SubmissionModel from "../models/submission.js";

const STRESS_DEMO_ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";
const TICKETFLOW_ASSESSMENT_ID = "6a33c6715b49b59d80732e97";

async function clearBehavioralForAssessment(assessmentId: string): Promise<number> {
  const result = await SubmissionModel.updateMany(
    { assessmentId },
    {
      $set: {
        behavioralGradingStatus: null,
        behavioralGradingError: null,
      },
      $unset: {
        behavioralGradingReport: "",
        behavioralGradingProgress: "",
      },
    },
  );
  return result.modifiedCount;
}

async function main(): Promise<void> {
  await connectMongoose();

  const stress = await clearBehavioralForAssessment(STRESS_DEMO_ASSESSMENT_ID);
  const ticketflow = await clearBehavioralForAssessment(TICKETFLOW_ASSESSMENT_ID);

  console.log(`Cleared behavioral grading on ${stress} stress-demo submission(s)`);
  console.log(`Cleared behavioral grading on ${ticketflow} TicketFlow submission(s)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
