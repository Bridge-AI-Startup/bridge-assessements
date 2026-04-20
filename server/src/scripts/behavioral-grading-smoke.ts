/**
 * Smoke script for behavioral grading.
 *
 * Usage:
 *   npm run behavioral-grading-smoke -- <submissionId>
 */
import "../config/loadEnv.js";
// Register models referenced by Submission.populate("assessmentId") before grading runs.
import "../models/assessment.js";
import connectMongoose from "../db/mongooseConnection.js";
import { gradeSubmissionBehavioral } from "../services/behavioralGrading/index.js";

async function main(): Promise<void> {
  const submissionId = process.argv[2];
  if (!submissionId) {
    throw new Error(
      "Missing submissionId. Usage: npm run behavioral-grading-smoke -- <submissionId>"
    );
  }

  await connectMongoose();

  console.log(`[behavioral-grading-smoke] grading submission ${submissionId}`);
  const started = Date.now();
  const report = await gradeSubmissionBehavioral(submissionId);
  const elapsedMs = Date.now() - started;

  const passed = report.cases.filter((c) => c.verdict === "pass").length;
  const failed = report.cases.filter((c) => c.verdict === "fail").length;
  const inconclusive = report.cases.filter(
    (c) => c.verdict === "inconclusive"
  ).length;

  console.log("Behavioral grading completed");
  console.log("elapsedMs:", elapsedMs);
  console.log("sandboxId:", report.sandbox.sandboxId);
  console.log("readmeRequirementPassed:", report.runbook.readmeRequirementPassed);
  console.log("caseCounts:", { passed, failed, inconclusive });
  console.log("reportArtifactKey:", report.reportArtifactKey ?? "n/a");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
