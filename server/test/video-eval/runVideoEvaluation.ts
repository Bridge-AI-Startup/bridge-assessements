/**
 * Video-evaluation E2E: prove the screen-recording → transcript → scoring path
 * works on a realistic 3-5 minute coding screencast.
 *
 * Pipeline (all real services — no HTTP/auth needed, calls the same functions
 * the controllers call):
 *   1. Generate a ~4 min coding screencast WebM (editor + terminal, pytest run).
 *   2. Seed a tagged user/assessment(criteria)/submission/proctoring session.
 *   3. Store the WebM as a video chunk on the session.
 *   4. generateTranscript()  — ffmpeg frame extraction + GPT-4o vision + stitch.
 *   5. evaluateTranscript()  — validate → ground → retrieve → score per criterion.
 *   6. Compare produced scores against expected bands; measure transcript quality
 *      and wall-clock timing; assert no permanent rate-limit jam.
 *   7. Write results.json for the canvas, save evidence, clean up tagged data.
 *
 * Run:  cd server && npm run test:video-eval
 *       VIDEO_EVAL_NO_CLEANUP=true npm run test:video-eval   # keep data/artifacts
 */

import "../../src/config/loadEnv.js";

import path from "path";

import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import ProctoringSessionModel from "../../src/models/proctoringSession.js";
import SubmissionModel from "../../src/models/submission.js";
import UserModel from "../../src/models/user.js";
import { getFrameStorage } from "../../src/services/capture/storage.js";
import { generateTranscript } from "../../src/ai/transcript/generator.js";
import { evaluateTranscript } from "../../src/services/evaluation/orchestrator.js";
import { proctoringJsonlToTranscriptEvents } from "../../src/services/evaluation/proctoringTranscriptAdapter.js";

import { withTimeout } from "../e2e/lib/runner.js";
import {
  EVIDENCE_DIR,
  RESULTS_DIR,
  saveEvidenceFile,
  repoRelative,
  ensureDirs,
} from "../e2e/lib/evidence.js";
import { cleanupTestData } from "../e2e/lib/cleanup.js";

import {
  CODING_VIDEO_SPEC,
  generateCodingVideo,
} from "./codingVideoFixture.js";
import {
  EXPECTED_CRITERIA,
  compareEvaluation,
  computeTranscriptQuality,
  overallScore,
} from "./scoring.js";
import fs from "fs/promises";

const BUDGET = {
  transcriptMs: 8 * 60 * 1000, // hard cap so a runaway run never jams the terminal
  evalMs: 4 * 60 * 1000,
};

const TS = () => new Date().toISOString();
const log = (m: string) => console.log(`[video-eval] ${m}`);

async function main() {
  const startedAt = Date.now();
  await connectMongoose();
  await ensureDirs();

  const stamp = Date.now();
  const email = `e2e+videoeval.${stamp}@bridge-e2e.test`;
  const storage = getFrameStorage();

  let sessionId: string | null = null;
  const result: any = {
    generatedAt: TS(),
    apiBaseUrl: "(direct service calls — no HTTP)",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL,
      OPENAI_MAX_CONCURRENT: process.env.OPENAI_MAX_CONCURRENT,
      TRANSCRIPT_BATCH_SIZE: process.env.TRANSCRIPT_BATCH_SIZE,
      TRANSCRIPT_BATCH_CONCURRENCY: process.env.TRANSCRIPT_BATCH_CONCURRENCY,
      PROCTORING_STORAGE_BACKEND: process.env.PROCTORING_STORAGE_BACKEND,
    },
    status: "fail",
    error: null,
    steps: [],
  };

  const step = (name: string, status: string, extra: Record<string, unknown> = {}) =>
    result.steps.push({ name, status, ...extra });

  try {
    // --- 1. Generate the coding screencast ---
    log("Generating ~4 min coding screencast (this encodes a real WebM)...");
    const tFix = Date.now();
    const video = await generateCodingVideo({ targetSeconds: 240 });
    const fixtureMs = Date.now() - tFix;
    log(
      `Video: ${video.stateCount} states, ${video.durationSeconds}s, ${(video.buffer.length / 1024).toFixed(0)} KB`
    );
    const videoEvidencePath = await saveEvidenceFile(
      "video-eval-coding-session.webm",
      video.buffer
    );
    const sampleFramePath = await saveEvidenceFile(
      "video-eval-sample-frame.png",
      video.sampleFramePng
    );
    step("Generate coding screencast", "pass", {
      durationSeconds: video.durationSeconds,
      stateCount: video.stateCount,
      sizeBytes: video.buffer.length,
      sha256: video.sha256,
      fixtureMs,
    });
    result.video = {
      durationSeconds: video.durationSeconds,
      stateCount: video.stateCount,
      sizeBytes: video.buffer.length,
      sha256: video.sha256,
      width: video.width,
      height: video.height,
      evidence: repoRelative(videoEvidencePath),
      sampleFrame: repoRelative(sampleFramePath),
    };

    // --- 2. Seed tagged user/assessment/submission/session ---
    log("Seeding tagged user/assessment/submission/proctoring session...");
    const user = await UserModel.create({
      firebaseUid: `e2e-videoeval-${stamp}`,
      email,
      companyName: "E2E Video Eval Co",
    });
    const assessment = await AssessmentModel.create({
      userId: user._id,
      title: `E2E Video Eval Assessment ${stamp}`,
      description:
        "Implement prime-number utilities (is_prime, primes_up_to) and test them.",
      timeLimit: 60,
      evaluationCriteria: EXPECTED_CRITERIA.map((c) => c.criterion),
    });
    const submission = await SubmissionModel.create({
      assessmentId: assessment._id,
      candidateName: "E2E Video Candidate",
      candidateEmail: email,
      status: "submitted",
      submittedAt: new Date(),
    });
    const start = Date.now() - video.durationSeconds * 1000;
    const session = await ProctoringSessionModel.create({
      submissionId: submission._id,
      token: submission.token,
      status: "completed",
      consent: { granted: true, grantedAt: new Date(start), screens: 1 },
      screens: [
        { screenIndex: 0, label: "Screen 1", width: video.width, height: video.height },
      ],
      stats: {
        captureStartedAt: new Date(start),
        captureEndedAt: new Date(),
      },
    });
    sessionId = session._id.toString();

    // --- 3. Store the WebM as a video chunk on the session ---
    const chunkKey = `${sessionId}/video/chunk-0.webm`;
    await storage.storeVideoChunk(chunkKey, video.buffer);
    session.videoChunks = [
      {
        storageKey: chunkKey,
        screenIndex: 0,
        startTime: new Date(start),
        endTime: new Date(),
        sizeBytes: video.buffer.length,
      },
    ] as any;
    await session.save();
    step("Seed session + store video chunk", "pass", {
      sessionId,
      submissionId: submission._id.toString(),
      chunkKey,
    });
    await video.cleanup();

    // --- 4. Transcript generation (ffmpeg extract + vision) ---
    log("Running generateTranscript() — frame extraction + GPT-4o vision...");
    const tTrans = Date.now();
    let transcriptResult;
    try {
      transcriptResult = await withTimeout(
        generateTranscript(sessionId),
        BUDGET.transcriptMs,
        "generateTranscript"
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      const rateLimited = /rate.?limit|429|too many requests/i.test(msg);
      step("Transcript generation", "fail", { error: msg, rateLimited });
      result.rateLimit = {
        hitPermanentJam: rateLimited,
        note: rateLimited
          ? "Transcript generation threw a rate-limit error after retries — investigate concurrency/backoff."
          : "Transcript generation failed for a non-rate-limit reason.",
      };
      throw err;
    }
    const transcriptMs = Date.now() - tTrans;
    log(
      `Transcript done in ${(transcriptMs / 1000).toFixed(1)}s: ${transcriptResult.frameCount} frames, ${transcriptResult.tokenUsage.total} tokens`
    );

    // --- 5. Load + quality-check the transcript ---
    const jsonl = await storage.getTranscript(transcriptResult.storageKey);
    const transcriptPath = await saveEvidenceFile(
      "video-eval-transcript.jsonl",
      jsonl
    );
    const quality = computeTranscriptQuality(jsonl, CODING_VIDEO_SPEC.expectedTokens);
    step("Transcript generation", "pass", {
      framesExtracted: transcriptResult.frameCount,
      transcriptSegments: quality.totalSegments,
      tokenUsage: transcriptResult.tokenUsage,
      transcriptMs,
      storageKey: transcriptResult.storageKey,
    });
    step("Transcript quality", quality.tokenRecall >= 0.5 ? "pass" : "fail", {
      tokenRecall: quality.tokenRecall,
      foundTokens: quality.foundTokens,
      missingTokens: quality.missingTokens,
      nonEmptyRatio: quality.nonEmptyRatio,
    });

    // --- 6. Evaluation (transcript → per-criterion scores) ---
    log("Running evaluateTranscript() — grounded per-criterion scoring...");
    const events = proctoringJsonlToTranscriptEvents(jsonl);
    const tEval = Date.now();
    const report = await withTimeout(
      evaluateTranscript(events, EXPECTED_CRITERIA.map((c) => c.criterion)),
      BUDGET.evalMs,
      "evaluateTranscript"
    );
    const evalMs = Date.now() - tEval;
    const comparison = compareEvaluation(report, EXPECTED_CRITERIA, 2 / 3);
    const overall = overallScore(report);
    log(
      `Evaluation done in ${(evalMs / 1000).toFixed(1)}s: ${comparison.matched}/${comparison.total} bands matched, overall=${overall ?? "n/a"}`
    );
    step("Score comparison vs expected", comparison.pass ? "pass" : "fail", {
      matched: comparison.matched,
      total: comparison.total,
      accuracy: comparison.accuracy,
      overallScore: overall,
    });

    // --- Assemble results ---
    result.pipeline = {
      eventCount: events.length,
      transcriptSegments: quality.totalSegments,
      framesExtracted: transcriptResult.frameCount,
      tokenUsage: transcriptResult.tokenUsage,
      transcriptStorageKey: transcriptResult.storageKey,
    };
    result.timings = {
      fixtureMs,
      transcriptMs,
      evalMs,
      totalMs: Date.now() - startedAt,
    };
    result.quality = quality;
    result.evaluation = {
      overallScore: overall,
      sessionSummary: report.session_summary,
      comparison,
    };
    result.rateLimit = result.rateLimit ?? {
      hitPermanentJam: false,
      note: `Transcript completed in ${(transcriptMs / 1000).toFixed(1)}s within the ${BUDGET.transcriptMs / 1000}s budget. Bounded concurrency (OPENAI_MAX_CONCURRENT=${process.env.OPENAI_MAX_CONCURRENT}) + Retry-After backoff (visionClient.withRetry) prevent permanent jams; proven in test/unit/visionRetry.test.ts.`,
    };
    result.evidence = {
      transcript: repoRelative(transcriptPath),
      sampleFrame: result.video.sampleFrame,
      video: result.video.evidence,
    };
    result.status =
      comparison.pass && quality.tokenRecall >= 0.5 ? "pass" : "fail";
  } catch (err: any) {
    result.error = String(err?.message || err);
    log(`ERROR: ${result.error}`);
  } finally {
    // --- 7. Cleanup ---
    const noCleanup = process.env.VIDEO_EVAL_NO_CLEANUP === "true";
    if (!noCleanup) {
      try {
        if (sessionId) {
          const keys = await storage.listKeys(`${sessionId}/`);
          for (const k of keys) await storage.delete(k).catch(() => {});
        }
      } catch {
        /* best effort */
      }
      try {
        const report = await cleanupTestData([email]);
        result.cleanup = report;
        log(`Cleanup: ${JSON.stringify(report)}`);
      } catch (e: any) {
        log(`Cleanup failed: ${e?.message || e}`);
      }
    } else {
      log("VIDEO_EVAL_NO_CLEANUP=true — leaving data + artifacts in place.");
    }

    const outPath = path.join(RESULTS_DIR, "video-eval-results.json");
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf-8");
    log(`Results written: ${outPath}`);
    log(
      `DONE: status=${result.status}` +
        (result.evaluation
          ? ` | ${result.evaluation.comparison.matched}/${result.evaluation.comparison.total} bands | overall=${result.evaluation.overallScore ?? "n/a"} | tokenRecall=${(result.quality.tokenRecall * 100).toFixed(0)}%`
          : "")
    );

    try {
      const mongoose = (await import("mongoose")).default;
      await mongoose.connection.close();
    } catch {
      /* ignore */
    }
    process.exit(result.status === "pass" ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("[video-eval] fatal:", e);
  process.exit(1);
});
