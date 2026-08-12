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
      .select(
        "_id candidateName candidateEmail status timeSpent submittedAt githubLink behavioralGradingStatus evaluationStatus"
      );

    if (submissions.length === 0) {
      console.log("No submissions found.");
      process.exit(0);
    }

    console.log(`Submissions (${submissions.length}):\n`);
    for (const s of submissions as any[]) {
      const id = s._id.toString();
      const name = s.candidateName ?? "(no name)";
      const time = s.timeSpent != null ? `${s.timeSpent}m` : "-";
      const github = s.githubLink ? "yes" : "no";
      const beh = s.behavioralGradingStatus ?? "-";
      const evalStatus = s.evaluationStatus ?? "-";
      console.log(`  ${id}`);
      console.log(
        `    candidate: ${name}  time: ${time}  github: ${github}  screenEval: ${evalStatus}  behavioral: ${beh}`
      );
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
