/**
 * Zip ticketflow/ solution and attach as code upload on a TicketFlow submission.
 * Does not seed behavioral grading or scores — use real E2B after upload.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedTicketFlowDemoSubmission.ts
 *
 * Env overrides:
 *   TICKETFLOW_ASSESSMENT_ID  default 6a33c6715b49b59d80732e97
 *   TICKETFLOW_SUBMISSION_ID  default lookup by token ticketflow_demo_saaz_2026
 *   TICKETFLOW_ZIP_ROOT       default ../ticketflow
 */

import "../config/loadEnv.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";
import { getSubmissionCodeStorage } from "../services/submissionCode/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

const DEFAULT_ASSESSMENT_ID = "6a33c6715b49b59d80732e97";
const DEFAULT_SUBMISSION_TOKEN = "ticketflow_demo_saaz_2026";

async function loadTicketflowBehavioralChecks(): Promise<string[]> {
  const raw = await fs.readFile(
    path.join(REPO_ROOT, "ticketflow/behavioral-checks.json"),
    "utf8",
  );
  return JSON.parse(raw) as string[];
}

async function zipTicketflow(sourceDir: string, outZip: string): Promise<void> {
  await fs.mkdir(path.dirname(outZip), { recursive: true });
  try {
    await fs.unlink(outZip);
  } catch {
    /* ignore */
  }
  execSync(
    `zip -r "${outZip}" . -x "*/node_modules/*" -x "node_modules/*" -x "*/.git/*" -x "scripts/starter-files.embedded.json" -x "scripts/assessment-doc.json" -x "scripts/mcp-insert-payload.json"`,
    { cwd: sourceDir, stdio: "inherit" },
  );
}

async function main(): Promise<void> {
  const assessmentId = process.env.TICKETFLOW_ASSESSMENT_ID || DEFAULT_ASSESSMENT_ID;
  const zipRoot = path.resolve(
    REPO_ROOT,
    process.env.TICKETFLOW_ZIP_ROOT || "ticketflow",
  );

  await connectMongoose();

  const behavioralChecks = await loadTicketflowBehavioralChecks();

  const assessment = await AssessmentModel.findById(assessmentId);
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  assessment.behavioralChecks = behavioralChecks;
  await assessment.save();
  console.log("Synced assessment behavioralChecks:", behavioralChecks.length);

  let submission = process.env.TICKETFLOW_SUBMISSION_ID
    ? await SubmissionModel.findById(process.env.TICKETFLOW_SUBMISSION_ID)
    : await SubmissionModel.findOne({ token: DEFAULT_SUBMISSION_TOKEN });

  if (!submission) {
    throw new Error(
      `Submission not found. Set TICKETFLOW_SUBMISSION_ID or create token ${DEFAULT_SUBMISSION_TOKEN}`,
    );
  }

  const submissionId = submission._id.toString();
  console.log("Assessment:", assessment.title);
  console.log("Submission:", submissionId, submission.candidateName || submission.candidateEmail);

  const tmpZip = path.join(SERVER_ROOT, "storage", "tmp", `ticketflow-${submissionId}.zip`);
  console.log("Zipping from", zipRoot);
  await zipTicketflow(zipRoot, tmpZip);
  const zipBuffer = await fs.readFile(tmpZip);
  const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const storageKey = `submissions/${submissionId}/ticketflow-submission.zip`;

  const codeStorage = getSubmissionCodeStorage();
  await codeStorage.storeArchive(storageKey, zipBuffer);
  console.log("Stored code archive:", storageKey, `(${zipBuffer.length} bytes)`);

  const submittedAt = new Date();
  const startedAt = submission.startedAt ?? new Date(Date.now() - 52 * 60_000);

  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      status: "submitted",
      codeSource: "upload",
      codeUpload: {
        storageKey,
        originalFilename: "ticketflow-submission.zip",
        sizeBytes: zipBuffer.length,
        sha256,
        uploadedAt: submittedAt,
      },
      githubLink: null,
      startedAt,
      submittedAt,
      timeSpent: submission.timeSpent ?? 52,
      behavioralGradingStatus: null,
      behavioralGradingError: null,
    },
    $unset: {
      behavioralGradingReport: "",
      behavioralGradingProgress: "",
    },
  });

  console.log("\nDone. Run real E2B:");
  console.log(`  npm run behavioral-grading-smoke -- ${submissionId}`);
  console.log("\nView:");
  console.log(`  /SubmissionsDashboard?assessmentId=${assessmentId}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
