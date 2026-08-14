/**
 * Full (non-sampled) screen evaluation for Shabad submission.
 * - Uses generateTranscript (all frames, checkpoint resume)
 * - Prefers screenshot frames by temporarily parking videoChunks
 * - Then evaluateTranscript → saves evaluationReport
 *
 * Run: npx tsx --env-file=config.env scripts/run-shabad-full-eval.ts
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import SubmissionModel from "../src/models/submission.ts";
import AssessmentModel from "../src/models/assessment.ts";
import ProctoringSessionModel from "../src/models/proctoringSession.ts";
import { generateTranscript } from "../src/ai/transcript/generator.ts";
import { getProctoringTranscriptForSubmission } from "../src/services/evaluation/proctoringTranscriptAdapter.ts";
import { evaluateTranscript } from "../src/services/evaluation/orchestrator.ts";

void AssessmentModel;

const submissionId = "6a7601cc0aa5d90129cd2c16";
const sessionId = "6a78ee900aa5d90129cd2e58";
const VIDEO_BACKUP_PATH = path.resolve(
  process.cwd(),
  "storage/proctoring",
  `${sessionId}.videoChunks.backup.json`
);

async function preferScreenshotFrames(): Promise<void> {
  const sess = await ProctoringSessionModel.findById(sessionId);
  if (!sess) throw new Error("session not found");
  const chunks = (sess as any).videoChunks;
  if (Array.isArray(chunks) && chunks.length > 0) {
    fs.mkdirSync(path.dirname(VIDEO_BACKUP_PATH), { recursive: true });
    fs.writeFileSync(VIDEO_BACKUP_PATH, JSON.stringify(chunks));
    // Native update so unknown schema paths are not required; screenshots path only.
    await ProctoringSessionModel.collection.updateOne(
      { _id: sess._id },
      { $set: { videoChunks: [] } }
    );
    console.log(
      `[eval] parked ${chunks.length} videoChunks → ${VIDEO_BACKUP_PATH} (screenshot path)`
    );
  } else {
    console.log("[eval] videoChunks already empty; using screenshot path");
  }
}

async function restoreVideoChunks(): Promise<void> {
  if (!fs.existsSync(VIDEO_BACKUP_PATH)) return;
  const backup = JSON.parse(fs.readFileSync(VIDEO_BACKUP_PATH, "utf8"));
  if (!Array.isArray(backup) || backup.length === 0) return;
  await ProctoringSessionModel.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(sessionId) },
    { $set: { videoChunks: backup } }
  );
  fs.unlinkSync(VIDEO_BACKUP_PATH);
  console.log(`[eval] restored ${backup.length} videoChunks from file backup`);
}

(async () => {
  await mongoose.connect(process.env.ATLAS_URI!, {
    dbName: process.env.DB_NAME || "bridge-assessments",
  });

  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!submission) throw new Error("submission not found");
  const assessment = submission.assessmentId as any;
  const criteria = assessment?.evaluationCriteria ?? [];
  if (!criteria.length) throw new Error("no evaluation criteria");

  console.log(
    `[eval] FULL screen eval starting for ${submissionId} (criteria=${criteria.length})`
  );
  console.log(
    `[eval] checkpoint every ${process.env.TRANSCRIPT_CHECKPOINT_EVERY_FRAMES || "50"} frames; resume=${process.env.TRANSCRIPT_CHECKPOINT_RESUME !== "false"}`
  );
  console.log(
    `[eval] TRANSCRIPT_REGION_DETECTION=${process.env.TRANSCRIPT_REGION_DETECTION ?? "(unset→enabled)"}`
  );

  await preferScreenshotFrames();

  try {
    // Reset thin sampled transcript metadata so we do not treat it as a full checkpoint.
    // Only resume if progressFramesProcessed is set (real mid-run checkpoint).
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw new Error("no proctoring session");
    const t = (session as any).transcript || {};
    const hasRealCheckpoint =
      typeof t.progressFramesProcessed === "number" &&
      t.progressFramesProcessed > 0 &&
      (t.status === "failed" ||
        t.status === "generating" ||
        t.status === "not_started");

    if (!hasRealCheckpoint) {
      console.log(
        "[eval] no usable full-run checkpoint; clearing sampled transcript metadata and starting from frame 0"
      );
      await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
        $set: {
          "transcript.status": "not_started",
          "transcript.error": null,
          "transcript.frameCount": null,
          "transcript.progressFramesProcessed": null,
          "transcript.progressTotalFrames": null,
          "transcript.progressBatchIndex": null,
          "transcript.progressTotalBatches": null,
          "transcript.lastIncrementalAt": null,
          "transcript.generatedAt": null,
          "transcript.storageKey": null,
          "transcript.tokenUsage": null,
        },
      });
    } else {
      console.log(
        `[eval] will resume from checkpoint at frame ${t.progressFramesProcessed}`
      );
    }

    (submission as any).evaluationStatus = "pending";
    (submission as any).evaluationError = null;
    await submission.save();

    console.log("[eval] generating transcript (FULL, all frames)...");
    await generateTranscript(sessionId);
    console.log("[eval] transcript generation complete");

    const screenTranscript =
      await getProctoringTranscriptForSubmission(submissionId);
    if (!screenTranscript?.length) {
      throw new Error("No screen recording transcript after generation");
    }
    console.log(
      `[eval] transcript events: ${screenTranscript.length} - running evaluateTranscript...`
    );

    const report = await evaluateTranscript(screenTranscript as any, criteria, {
      groundings: assessment.evaluationCriteriaGroundings,
    });

    (submission as any).evaluationReport = report;
    (submission as any).screenRecordingTranscript = screenTranscript;
    (submission as any).evaluationStatus = "completed";
    (submission as any).evaluationError = null;
    await submission.save();

    console.log(
      JSON.stringify(
        {
          ok: true,
          evaluationStatus: "completed",
          transcriptEvents: screenTranscript.length,
          criteriaResults: (report?.criteria_results || []).map((r: any) => ({
            criterion: String(r.criterion || "").slice(0, 90),
            score: r.score,
            evaluable: r.evaluable,
          })),
          sessionSummaryPreview: String(report?.session_summary || "").slice(
            0,
            600
          ),
        },
        null,
        2
      )
    );

    // Only restore video after a successful full eval so crash/resume keeps screenshot path.
    await restoreVideoChunks();
  } catch (err) {
    console.error(
      "[eval] FAILED (videoChunks left parked for screenshot resume):",
      err instanceof Error ? err.stack || err.message : err
    );
    throw err;
  }

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(
    "[eval] FAILED:",
    e instanceof Error ? e.stack || e.message : e
  );
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
