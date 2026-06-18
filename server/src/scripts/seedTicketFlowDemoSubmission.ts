/**
 * Seeds a completed TicketFlow demo submission:
 * - zips ticketflow/ solution and stores as code upload
 * - attaches realistic behavioral grading report + artifact PNGs (no E2B run)
 * - sets scores, timestamps, and completeness breakdown
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedTicketFlowDemoSubmission.ts
 *
 * Env overrides:
 *   TICKETFLOW_ASSESSMENT_ID  default 6a33c6715b49b59d80732e97
 *   TICKETFLOW_SUBMISSION_ID    default lookup by token ticketflow_demo_saaz_2026
 *   TICKETFLOW_ZIP_ROOT         default ../ticketflow (repo root relative to server/)
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
import { getGradingEvidenceStorage } from "../services/gradingEvidence/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

const DEFAULT_ASSESSMENT_ID = "6a33c6715b49b59d80732e97";
const DEFAULT_SUBMISSION_TOKEN = "ticketflow_demo_saaz_2026";

/** 1×1 PNG — valid image for artifact previews */
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJAD9x1k05WAAAAAElFTkSuQmCC",
  "base64",
);

const NPM_TEST_STDOUT = `> ticketflow-server@1.0.0 test
> NODE_ENV=test tsx --test tests/*.test.ts

▶ TicketFlow API
  ✔ Bug 1 — status state machine
  ✔ Bug 2 — priority filter
  ✔ Bug 3 — chronological sort order
  ✔ Baseline behavior
ℹ tests 4
ℹ pass 4
ℹ fail 0`;

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function buildFakeBehavioralReport(submissionId: string, checks: string[]) {
  const startedAt = isoMinutesAgo(55);
  const completedAt = isoMinutesAgo(48);
  const sandboxId = `e2b_${crypto.randomBytes(8).toString("hex")}`;

  const installEvidence = {
    id: crypto.randomUUID(),
    type: "command" as const,
    input: { purpose: "install", command: "cd server && npm install" },
    startedAt: isoMinutesAgo(54),
    finishedAt: isoMinutesAgo(53),
    success: true,
    exitCode: 0,
    stdoutSnippet: "added 169 packages, audited 170 packages in 7s",
  };

  const testEvidence = {
    id: crypto.randomUUID(),
    type: "command" as const,
    input: { purpose: "test", command: "cd server && npm test" },
    startedAt: isoMinutesAgo(52),
    finishedAt: isoMinutesAgo(51),
    success: true,
    exitCode: 0,
    stdoutSnippet: NPM_TEST_STDOUT,
  };

  const verdicts: Array<"pass" | "fail" | "inconclusive"> = [
    "pass",
    "pass",
    "pass",
    "pass",
    "pass",
    "inconclusive",
  ];

  const rationales = [
    "PATCH /api/tickets/:id returned 400 with INVALID_STATUS_TRANSITION when attempting open → resolved. Verified with curl and npm test.",
    "GET /api/tickets?priority=high returned only tickets where priority === 'high'; no low-priority rows in response body.",
    "Ticket list ordered oldest-first: first item was 'Login page returns 500' (earliest createdAt in seed data).",
    "GET /api/tickets?search=login matched title case-insensitively; frontend search input debounced at 300ms.",
    "GET /api/stats returned { open: 3, in_progress: 1, resolved: 1 } matching manual count from GET /api/tickets.",
    "All four npm test cases passed in sandbox; search edge case with empty query was not explicitly covered by tests (inconclusive on empty-string semantics).",
  ];

  const cases = checks.map((checkText, checkIndex) => {
    const artifactKey = `submissions/${submissionId}/behavioral-agent/demo-check-${checkIndex}.png`;
    const verdict = verdicts[checkIndex] ?? "pass";
    return {
      checkText,
      checkIndex,
      verdict,
      evidence: [
        ...(checkIndex === 0 ? [installEvidence, testEvidence] : []),
        {
          id: crypto.randomUUID(),
          type: "judge" as const,
          input: {
            checkText,
            entryCommand: checkIndex < 4 ? "cd server && npm test" : "curl -s localhost:5070/api/stats",
            mainSourcePath: "server/src/routes/tickets.ts",
          },
          startedAt: isoMinutesAgo(50 - checkIndex),
          finishedAt: isoMinutesAgo(49 - checkIndex),
          success: verdict === "pass",
          verdict,
          rationale: rationales[checkIndex] ?? "Check evaluated against submitted codebase.",
          citations: [
            "server/src/routes/tickets.ts",
            checkIndex >= 4 ? "client/src/App.jsx" : "server/tests/tickets.test.ts",
          ],
          agentTrace:
            checkIndex === 0
              ? [
                  {
                    iteration: 1,
                    tool: "run_command",
                    success: true,
                    detail: "cd server && npm test",
                    outputPreview: NPM_TEST_STDOUT.slice(0, 400),
                  },
                  {
                    iteration: 2,
                    tool: "read_file",
                    success: true,
                    detail: "server/src/routes/tickets.ts",
                    outputPreview: "isAllowedStatusTransition(from, to)...",
                  },
                ]
              : undefined,
        },
      ],
      artifacts: verdict === "fail" ? [] : [artifactKey],
    };
  });

  return {
    report: {
      sandbox: { sandboxId, timeoutMs: 1_800_000 },
      runbook: {
        summary:
          "Extracted archive, ran npm install + npm test in server/, started API on :5070 and probed /api/tickets and /api/stats.",
        readmeRequirementPassed: true,
        readmeRequirementDetail: {
          passed: true,
          inferredStepCount: 0,
          hasInstallCommand: true,
          hasTestCommand: true,
          hasStartCommand: true,
          summary:
            "Passed: README lists install (npm install), test (npm test), and dev server commands.",
        },
        evidence: [installEvidence, testEvidence],
        baseUrl: "http://127.0.0.1:5070",
        executionProfile: "web_server" as const,
      },
      setup: {
        status: "ready" as const,
        phase: "complete" as const,
        summary: "Runbook install/test succeeded; health check on /health returned 200.",
        failedSteps: [],
        healthWait: {
          attempted: true,
          ready: true,
          attempts: 3,
          elapsedMs: 4200,
        },
      },
      failureCategory: null,
      cases,
      startedAt,
      completedAt,
      reportArtifactKey: `submissions/${submissionId}/report.json`,
    },
    artifactKeys: cases.flatMap((c) => c.artifacts),
  };
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

  const assessment = await AssessmentModel.findById(assessmentId).lean();
  if (!assessment) {
    throw new Error(`Assessment not found: ${assessmentId}`);
  }

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
  console.log("Zipping solution from", zipRoot);
  await zipTicketflow(zipRoot, tmpZip);
  const zipBuffer = await fs.readFile(tmpZip);
  const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const storageKey = `submissions/${submissionId}/ticketflow-submission.zip`;

  const codeStorage = getSubmissionCodeStorage();
  await codeStorage.storeArchive(storageKey, zipBuffer);
  console.log("Stored code archive:", storageKey, `(${zipBuffer.length} bytes)`);

  const checks: string[] = Array.isArray(assessment.behavioralChecks)
    ? assessment.behavioralChecks
    : [];

  const { report, artifactKeys } = buildFakeBehavioralReport(submissionId, checks);
  const gradingStorage = getGradingEvidenceStorage();

  for (const key of artifactKeys) {
    await gradingStorage.storeArtifact(key, MINIMAL_PNG);
  }
  await gradingStorage.storeText(
    report.reportArtifactKey!,
    JSON.stringify(report, null, 2),
  );
  console.log("Stored", artifactKeys.length, "behavioral artifact PNGs");

  const startedAt = new Date(Date.now() - 52 * 60_000);
  const submittedAt = new Date(Date.now() - 5 * 60_000);

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
      timeSpent: 52,
      behavioralGradingStatus: "completed",
      behavioralGradingError: null,
      behavioralGradingReport: report,
      scores: {
        overall: 91,
        completeness: {
          score: 91,
          breakdown: {
            requirementsMet: 11,
            totalRequirements: 12,
            details: [
              { requirement: "Status state machine enforced", met: true },
              { requirement: "Priority filter exact match", met: true },
              { requirement: "Oldest-first sort", met: true },
              { requirement: "Search API + UI", met: true },
              { requirement: "Stats endpoint + summary bar", met: true },
              { requirement: "All server tests pass", met: true },
              { requirement: "Search empty-query edge case documented", met: false },
            ],
          },
        },
        calculatedAt: new Date(),
        calculationVersion: "demo-seed-v1",
      },
    },
  });

  console.log("\nDone.");
  console.log("Submission ID:", submissionId);
  console.log("Token:", submission.token);
  console.log(
    "View: /SubmissionsDashboard?assessmentId=" + assessmentId,
  );
  console.log(
    "Candidate link: /CandidateAssessment?token=" + submission.token,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
