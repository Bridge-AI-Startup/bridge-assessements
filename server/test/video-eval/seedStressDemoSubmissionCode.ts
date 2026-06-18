/**
 * Zip and upload real sample Webhook Dispatcher code for each stress-demo submission.
 * Replaces placeholder codeUpload keys (demo/stress-*.zip) with actual archives.
 *
 * Run (from server/):
 *   npm run seed:stress-demo-code
 *
 * Env overrides:
 *   STRESS_DEMO_ASSESSMENT_ID  default 6a30cb825c1e8969b7c21110
 */

import "../../src/config/loadEnv.js";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import SubmissionModel from "../../src/models/submission.js";
import { getSubmissionCodeStorage } from "../../src/services/submissionCode/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";
const BASE_PROJECT = path.resolve(__dirname, "../demo-submissions/webhook-dispatcher");
const VARIANTS_DIR = path.join(BASE_PROJECT, "variants");

/** Extra files copied into the zip root per candidate persona. */
const VARIANT_FILES: Record<string, Array<{ src: string; dest: string }>> = {
  "Steady writer": [{ src: "steady/SESSION_NOTES.md", dest: "SESSION_NOTES.md" }],
  "Debug / test loop": [{ src: "debug/DEBUG_LOG.md", dest: "DEBUG_LOG.md" }],
  "AI-assisted": [{ src: "ai_heavy/AI_CHAT_LOG.md", dest: "AI_CHAT_LOG.md" }],
};

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "variants" ||
      entry.name === "node_modules" ||
      entry.name === ".venv" ||
      entry.name === "__pycache__"
    ) {
      continue;
    }
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

async function buildSubmissionZip(
  candidateName: string,
  outZip: string,
): Promise<void> {
  const tmpDir = path.join(
    SERVER_ROOT,
    "storage",
    "tmp",
    `webhook-dispatcher-${crypto.randomBytes(6).toString("hex")}`,
  );
  await fs.rm(tmpDir, { recursive: true, force: true });
  await copyDir(BASE_PROJECT, tmpDir);

  const extras = VARIANT_FILES[candidateName] ?? [];
  for (const { src, dest } of extras) {
    await fs.copyFile(path.join(VARIANTS_DIR, src), path.join(tmpDir, dest));
  }

  await fs.mkdir(path.dirname(outZip), { recursive: true });
  try {
    await fs.unlink(outZip);
  } catch {
    /* ignore */
  }
  execSync(`zip -r "${outZip}" . -x "*/__pycache__/*" -x "__pycache__/*"`, {
    cwd: tmpDir,
    stdio: "pipe",
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const assessmentId = process.env.STRESS_DEMO_ASSESSMENT_ID || DEFAULT_ASSESSMENT_ID;

  await connectMongoose();

  const assessment = await AssessmentModel.findById(assessmentId).lean();
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

  const submissions = await SubmissionModel.find({ assessmentId: assessment._id }).sort({
    candidateName: 1,
  });
  if (submissions.length === 0) {
    throw new Error(`No submissions for assessment ${assessmentId}`);
  }

  console.log(`Assessment: ${assessment.title}`);
  console.log(`Base project: ${BASE_PROJECT}`);
  console.log(`Submissions: ${submissions.length}\n`);

  const codeStorage = getSubmissionCodeStorage();

  for (const submission of submissions) {
    const name = submission.candidateName || submission.candidateEmail || "Unknown";
    const submissionId = submission._id.toString();
    const tmpZip = path.join(
      SERVER_ROOT,
      "storage",
      "tmp",
      `webhook-dispatcher-${submissionId}.zip`,
    );

    await buildSubmissionZip(name, tmpZip);
    const zipBuffer = await fs.readFile(tmpZip);
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    const storageKey = `submissions/${submissionId}/webhook-dispatcher-submission.zip`;

    await codeStorage.storeArchive(storageKey, zipBuffer);

    await SubmissionModel.findByIdAndUpdate(submissionId, {
      $set: {
        codeSource: "upload",
        codeUpload: {
          storageKey,
          originalFilename: "webhook-dispatcher-submission.zip",
          sizeBytes: zipBuffer.length,
          sha256,
          uploadedAt: submission.submittedAt ?? new Date(),
        },
      },
    });

    console.log(
      `✓ ${name}: ${storageKey} (${zipBuffer.length} bytes, sha256 ${sha256.slice(0, 12)}…)`,
    );
  }

  console.log("\nDone. Download from SubmissionsDashboard → Download code archive.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
