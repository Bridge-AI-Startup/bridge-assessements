/**
 * Seed demo data: one employer, two assessments, several submissions (mixed statuses).
 * Run: npm run seed
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "config.env") });
dotenv.config();

import mongoose from "mongoose";
import UserModel from "./models/user.js";
import AssessmentModel from "./models/assessment.js";
import SubmissionModel from "./models/submission.js";
import { generateApiToken, generateSubmissionToken } from "./utils/token.js";

const ATLAS_URI = process.env.ATLAS_URI;
const DB_NAME = process.env.DB_NAME || "bridge-assessment-mini";

if (!ATLAS_URI) {
  console.error("Missing ATLAS_URI in config.env");
  process.exit(1);
}

await mongoose.connect(ATLAS_URI, {
  dbName: DB_NAME,
  serverSelectionTimeoutMS: 8_000,
});

await SubmissionModel.deleteMany({});
await AssessmentModel.deleteMany({});
await UserModel.deleteMany({});

const apiToken = generateApiToken();
const user = await UserModel.create({
  email: "seed@bridge-mini.local",
  companyName: "Seed Co",
  apiToken,
});

const a1 = await AssessmentModel.create({
  userId: user._id,
  title: "Backend API exercise",
  description: "Implement the assessment endpoints.",
  timeLimit: 120,
});

const a2 = await AssessmentModel.create({
  userId: user._id,
  title: "Frontend take-home",
  description: "Build a small React flow.",
  timeLimit: 90,
});

const t1 = generateSubmissionToken();
const t2 = generateSubmissionToken();
const t3 = generateSubmissionToken();

await SubmissionModel.create({
  token: t1,
  assessmentId: a1._id,
  candidateName: "Ada",
  displayName: "Ada L.",
  candidateEmail: "ada@example.com",
  status: "pending",
});

await SubmissionModel.create({
  token: t2,
  assessmentId: a1._id,
  candidateName: "Bob",
  candidateEmail: "bob@example.com",
  status: "in-progress",
  startedAt: new Date(Date.now() - 15 * 60000),
});

await SubmissionModel.create({
  token: t3,
  assessmentId: a2._id,
  candidateName: "Chen",
  candidateEmail: "chen@example.com",
  status: "submitted",
  startedAt: new Date(Date.now() - 120 * 60000),
  submittedAt: new Date(Date.now() - 30 * 60000),
  timeSpent: 90,
  submissionNotes: "Completed all tasks.",
});

console.log("\n--- Seed complete ---");
console.log("Employer API token (Authorization: Bearer ...):");
console.log(apiToken);
console.log("\nAssessment IDs:");
console.log("  a1:", String(a1._id));
console.log("  a2:", String(a2._id));
console.log("\nCandidate tokens (use /candidate?token=...):");
console.log("  pending:   ", t1);
console.log("  in-progress:", t2);
console.log("  submitted: ", t3);
console.log("");

await mongoose.disconnect();
