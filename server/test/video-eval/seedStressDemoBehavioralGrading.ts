/**
 * Attach fake E2B behavioral grading to the 4 stress-demo submissions.
 *
 * Run (from server/):
 *   npm run seed:stress-demo-behavioral
 */

import "../../src/config/loadEnv.js";

import mongoose from "mongoose";
import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import SubmissionModel from "../../src/models/submission.js";
import { getGradingEvidenceStorage } from "../../src/services/gradingEvidence/storage.js";
import {
  buildStressDemoBehavioralReport,
  getStressDemoAssessmentId,
  WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS,
} from "../../src/services/behavioralGrading/stressDemoSimulation.js";

async function main(): Promise<void> {
  const assessmentId = getStressDemoAssessmentId();

  await connectMongoose();

  await AssessmentModel.findByIdAndUpdate(assessmentId, {
    $set: { behavioralChecks: WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS },
  });

  const assessment = await AssessmentModel.findById(assessmentId).lean();
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const checks = WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS;
  const submissions = await SubmissionModel.find({ assessmentId: assessment._id }).sort({
    candidateName: 1,
  });

  if (submissions.length === 0) {
    throw new Error(`No submissions for assessment ${assessmentId}`);
  }

  console.log(`Assessment: ${assessment.title}`);
  console.log(`Behavioral checks (${checks.length}):`);
  for (const [i, c] of checks.entries()) {
    console.log(`  ${i + 1}. ${c}`);
  }
  console.log(`Submissions: ${submissions.length}\n`);

  const gradingStorage = getGradingEvidenceStorage();

  for (const submission of submissions) {
    const name = submission.candidateName || submission.candidateEmail || "Unknown";
    const submissionId = submission._id.toString();
    const report = buildStressDemoBehavioralReport(submissionId, name, checks);

    if (report.reportArtifactKey) {
      await gradingStorage.storeText(
        report.reportArtifactKey,
        JSON.stringify(report, null, 2),
      );
    }

    await SubmissionModel.findByIdAndUpdate(submissionId, {
      $set: {
        behavioralGradingStatus: "completed",
        behavioralGradingError: null,
        behavioralGradingReport: report,
      },
    });

    const passCount = report.cases.filter((c) => c.verdict === "pass").length;
    const inconclusive = report.cases.filter((c) => c.verdict === "inconclusive").length;
    const behPct = Math.round(((passCount + inconclusive * 0.5) / checks.length) * 100);
    console.log(
      `✓ ${name}: ${passCount} pass, ${inconclusive} inconclusive (~${behPct}% behavioral)`,
    );
  }

  console.log("\nDone. View:");
  console.log(`  /SubmissionsDashboard?assessmentId=${assessmentId}`);
  console.log("  (sign in as demo@bridgeai-demo.com)");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
