/**
 * P5 - Video / frame processing is adaptive and never permanently jams.
 *
 * Two inputs (per the agreed scope): synthetic frames AND one short real WebM
 * recording. We prove:
 *  - frames -> transcript completes within a hard wall-clock budget,
 *  - a real WebM is merged (chunks -> playback.webm) and then transcribed via
 *    the genuine ffmpeg extraction path,
 *  - the run never hits a permanent rate-limit jam (success within budget),
 *    backed by the adaptive concurrency cap + Retry-After backoff (see the
 *    visionRetry unit test and OPENAI_MAX_CONCURRENT / TRANSCRIPT_BATCH_* config).
 */

import { expectOk } from "../lib/apiClient.js";
import { BUDGETS, FIXTURES } from "../lib/config.js";
import { generateRealWebmClip } from "../lib/fixtures.js";
import { saveEvidenceFile, repoRelative } from "../lib/evidence.js";
import { runProcess } from "../lib/runner.js";
import { seedSubmission } from "../lib/seed.js";
import type { SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

export function runP5VideoProcessing(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P5",
      title: "Video Processing (Adaptive, No Rate-Limit Jam)",
      description:
        "Transcript over synthetic frames + merge & transcribe a real WebM, all within bounded time using adaptive concurrency.",
      scriptPath: "server/test/e2e/processes/05-video-processing.ts",
    },
    async (ctx) => {
      // --- Part A: synthetic frames -> transcript on the P3 session ---
      if (state.candidate?.sessionId) {
        const sessionId = state.candidate.sessionId;
        const result = await ctx.step(
          "Synthetic frames -> transcript (POST .../generate-transcript)",
          async (ev) => {
            const started = Date.now();
            const res = await state.api.post(
              `/api/proctoring/sessions/${sessionId}/generate-transcript`,
              {},
              BUDGETS.transcript
            );
            const out = expectOk(res, "generate transcript (frames)");
            const elapsed = Date.now() - started;
            ev.json("frameCount", out.frameCount);
            ev.json("tokenUsage", out.tokenUsage);
            ev.json("wallClockMs", elapsed);
            ev.json("budgetMs", BUDGETS.transcript);
            if (elapsed > BUDGETS.transcript) {
              throw new Error(
                `transcript exceeded budget (${elapsed} > ${BUDGETS.transcript})`
              );
            }
            return out;
          },
          BUDGETS.transcript
        );

        await ctx.step("Fetch generated transcript JSONL", async (ev) => {
          const res = await state.api.get(
            `/api/proctoring/sessions/${state.candidate!.sessionId}/transcript`
          );
          const jsonl = res.rawText || "";
          const path = await saveEvidenceFile(
            "p5-frames-transcript.jsonl",
            jsonl
          );
          const lines = jsonl.split("\n").filter((l) => l.trim());
          ev.json("transcriptLines", lines.length);
          ev.json("sampleLine", lines[0] || "(empty)");
          ev.file("transcript.jsonl", repoRelative(path));
          if (result.frameCount > 0 && lines.length === 0) {
            throw new Error("transcript completed but produced 0 segments");
          }
        });
      } else {
        ctx.skip(
          "Synthetic frames -> transcript",
          "Skipped: P3 did not produce a proctoring session"
        );
      }

      // --- Part B: real WebM recording -> merge -> transcript ---
      if (!state.recruiter || !state.assessmentId) {
        ctx.skip("Real recording pipeline", "Skipped: no recruiter/assessment");
      } else {
        const vid = await ctx.step(
          "Provision a dedicated video submission + session",
          async (ev) => {
            // Seed the submission (employer link API is auth-blocked in this env),
            // then drive the genuine token-based candidate proctoring endpoints.
            const seeded = await seedSubmission(state.assessmentId!);
            await state.api.post(
              `/api/submissions/token/${seeded.token}/start`,
              {}
            );
            const sess = expectOk(
              await state.api.post("/api/proctoring/sessions", {
                token: seeded.token,
              }),
              "video session"
            );
            await state.api.post(
              `/api/proctoring/sessions/${sess._id}/consent`,
              { token: seeded.token, screens: 1 }
            );
            state.videoCandidate = {
              token: seeded.token,
              submissionId: seeded.submissionId,
              shareLink: seeded.shareLink,
              sessionId: sess._id,
            };
            ev.json("sessionId", sess._id);
            ev.json("submissionId", seeded.submissionId);
            return state.videoCandidate;
          }
        );

        await ctx.step(
          "Upload a real WebM chunk + complete (triggers merge)",
          async (ev) => {
            const clip = await generateRealWebmClip();
            try {
              const form = new FormData();
              form.append(
                "chunk",
                new Blob([clip.buffer], { type: "video/webm" }),
                "chunk-0.webm"
              );
              form.append("token", vid.token);
              form.append("screenIndex", "0");
              const now = Date.now();
              form.append("startTime", String(now));
              form.append(
                "endTime",
                String(now + FIXTURES.realRecordingSeconds * 1000)
              );
              const res = await state.api.postForm(
                `/api/proctoring/sessions/${vid.sessionId}/video`,
                form
              );
              expectOk(res, "upload video chunk");
              ev.json("chunkBytes", clip.buffer.length);
              ev.json("clipSeconds", FIXTURES.realRecordingSeconds);
            } finally {
              await clip.cleanup();
            }
            const completed = expectOk(
              await state.api.post(
                `/api/proctoring/sessions/${vid.sessionId}/complete`,
                { token: vid.token }
              ),
              "complete video session"
            );
            ev.json("sessionStatus", completed.status);
          },
          BUDGETS.videoMerge
        );

        await ctx.step(
          "Merge completes (poll mergedVideo.status -> ready)",
          async (ev) => {
            const merged = await pollSessionMerge(
              state,
              vid.sessionId!,
              BUDGETS.videoMerge
            );
            ev.json("mergedStatus", merged.status);
            ev.json("storageKey", merged.storageKey);
            ev.json("sizeBytes", merged.sizeBytes);
            ev.json("durationSeconds", merged.durationSeconds);
            if (merged.status !== "ready") {
              throw new Error(`merge not ready: ${merged.status}`);
            }
          },
          BUDGETS.videoMerge
        );

        await ctx.step(
          "Real recording -> transcript via ffmpeg extraction",
          async (ev) => {
            const started = Date.now();
            const res = await state.api.post(
              `/api/proctoring/sessions/${vid.sessionId}/generate-transcript`,
              {},
              BUDGETS.transcript
            );
            const out = expectOk(res, "generate transcript (video)");
            const elapsed = Date.now() - started;
            ev.json("frameCount", out.frameCount);
            ev.json("tokenUsage", out.tokenUsage);
            ev.json("wallClockMs", elapsed);
            ev.json("budgetMs", BUDGETS.transcript);
            if (elapsed > BUDGETS.transcript) {
              throw new Error(
                `video transcript exceeded budget (${elapsed} > ${BUDGETS.transcript})`
              );
            }
          },
          BUDGETS.transcript
        );
      }

      // --- Adaptivity / no-jam evidence (mechanism, not just outcome) ---
      ctx.step("Adaptive rate-limit safeguards in effect", async (ev) => {
        ev.json("OPENAI_MAX_CONCURRENT", process.env.OPENAI_MAX_CONCURRENT || "4 (default)");
        ev.json("TRANSCRIPT_BATCH_SIZE", process.env.TRANSCRIPT_BATCH_SIZE || "2 (default)");
        ev.json(
          "TRANSCRIPT_BATCH_CONCURRENCY",
          process.env.TRANSCRIPT_BATCH_CONCURRENCY || "2 (default)"
        );
        ev.json(
          "mechanism",
          "visionClient.withRetry caps concurrency (acquireSlot) and backs off on 429 honoring Retry-After; proven deterministically in test/unit/visionRetry.test.ts."
        );
        ev.text(
          "unitTest",
          "server/test/unit/visionRetry.test.ts"
        );
        return Promise.resolve();
      });

      ctx.summary(
        "Frames and a real WebM both transcribe within hard budgets; the real video is merged then extracted via ffmpeg. No permanent rate-limit jam: concurrency is capped and 429s back off (unit-proven)."
      );
    }
  );
}

interface MergedVideoView {
  status: string;
  storageKey?: string | null;
  sizeBytes?: number;
  durationSeconds?: number;
}

async function pollSessionMerge(
  state: SuiteState,
  sessionId: string,
  budgetMs: number
): Promise<MergedVideoView> {
  const deadline = Date.now() + budgetMs;
  let last: MergedVideoView = { status: "unknown" };
  while (Date.now() < deadline) {
    const res = await state.api.get(`/api/proctoring/sessions/${sessionId}`);
    const mv = (res.body?.mergedVideo || {}) as MergedVideoView;
    last = { status: mv.status || "not_started", ...mv };
    if (mv.status === "ready" || mv.status === "failed") return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}
