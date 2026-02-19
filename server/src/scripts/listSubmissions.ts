/**
 * List submissions for an assessment (to get submission IDs for scripts).
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/listSubmissions.ts <assessmentId>
 *   npx tsx src/scripts/listSubmissions.ts <assessmentId> "Austin"   # filter by candidate name
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";

async function main() {
  const assessmentId = process.argv[2];
  const candidateFilter = process.argv[3]?.trim(); // e.g. "Austin"

  if (!assessmentId) {
    console.error("Usage: npx tsx src/scripts/listSubmissions.ts <assessmentId> [candidateName]");
    process.exit(1);
  }

  try {
    await connectMongoose();

    const query: Record<string, unknown> = { assessmentId };
    if (candidateFilter) {
      query.candidateName = new RegExp(candidateFilter, "i");
    }

    const submissions = await SubmissionModel.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .lean()
      .select("_id candidateName candidateEmail status timeSpent submittedAt githubLink scores.overall scores.completeness llmWorkflow.trace.totalTokens llmWorkflow.trace.totalCost llmWorkflow.trace.totalTime");

    if (submissions.length === 0) {
      console.log("No submissions found.");
      process.exit(0);
    }

    console.log(`Submissions (${submissions.length}):\n`);
    for (const s of submissions as any[]) {
      const id = s._id.toString();
      const name = s.candidateName ?? "(no name)";
      const time = s.timeSpent != null ? `${s.timeSpent}m` : "-";
      const overall = s.scores?.overall != null ? s.scores.overall : "-";
      const completeness = s.scores?.completeness?.score != null ? `${s.scores.completeness.score}%` : "-";
      const github = s.githubLink ? "yes" : "no";
      console.log(`  ${id}`);
      console.log(`    candidate: ${name}  time: ${time}  score: ${overall}/100  completeness: ${completeness}  github: ${github}`);
      console.log("");
    }
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
