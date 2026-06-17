/**
 * P3 - Candidate completes an assessment (any duration).
 * Proves: a candidate can open the link, start, be proctored (consent + frames
 * + sidecar events), spend an arbitrary (parameterized) duration, and submit
 * their code via archive upload. Duration is parameterized so "any duration"
 * is demonstrated without long real-time waits.
 */

import { expectOk } from "../lib/apiClient.js";
import { BUDGETS } from "../lib/config.js";
import { generateSampleRepoZip, generateSyntheticFrames } from "../lib/fixtures.js";
import { runProcess } from "../lib/runner.js";
import type { SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

const CANDIDATE_DURATION_MS = Number(
  process.env.E2E_CANDIDATE_DURATION_MS || 1500
);

export function runP3CandidateComplete(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P3",
      title: "Candidate Completes Assessment",
      description:
        "Start -> proctoring session (consent, frames, events) -> arbitrary duration -> submit code by upload.",
      scriptPath: "server/test/e2e/processes/03-candidate-complete.ts",
    },
    async (ctx) => {
      if (!state.candidate) {
        ctx.skip("All steps", "Skipped: P2 did not produce a candidate token");
        return;
      }
      const { token } = state.candidate;
      const api = state.api; // candidate flow is token-based, no auth

      await ctx.step("Start assessment (POST /token/:token/start)", async (ev) => {
        const res = await api.post(
          `/api/submissions/token/${token}/start`,
          {}
        );
        const sub = expectOk(res, "start assessment");
        ev.json("status", sub.status);
        ev.json("timeRemaining", sub.timeRemaining);
        if (sub.status !== "in-progress") {
          throw new Error(`expected in-progress, got ${sub.status}`);
        }
      });

      const sessionId = await ctx.step(
        "Create proctoring session (POST /api/proctoring/sessions)",
        async (ev) => {
          const res = await api.post("/api/proctoring/sessions", { token });
          const sess = expectOk(res, "create session");
          ev.json("sessionId", sess._id);
          ev.json("status", sess.status);
          return sess._id as string;
        }
      );
      state.candidate.sessionId = sessionId;

      await ctx.step(
        "Grant consent (POST /api/proctoring/sessions/:id/consent)",
        async (ev) => {
          const res = await api.post(
            `/api/proctoring/sessions/${sessionId}/consent`,
            { token, screens: 1 }
          );
          const sess = expectOk(res, "consent");
          ev.json("status", sess.status);
          ev.json("consentGranted", sess.consent?.granted);
          if (sess.status !== "active") {
            throw new Error(`session not active after consent: ${sess.status}`);
          }
        }
      );

      await ctx.step(
        "Upload proctoring frames (POST /api/proctoring/sessions/:id/frames)",
        async (ev) => {
          const frames = await generateSyntheticFrames();
          const base = Date.now();
          let uploaded = 0;
          let duplicates = 0;
          for (const f of frames) {
            const form = new FormData();
            form.append(
              "frame",
              new Blob([f.buffer], { type: "image/png" }),
              `frame-${f.index}.png`
            );
            form.append("token", token);
            form.append("screenIndex", "0");
            form.append("capturedAt", String(base + f.index * 1000));
            form.append("width", String(f.width));
            form.append("height", String(f.height));
            const res = await api.postForm(
              `/api/proctoring/sessions/${sessionId}/frames`,
              form
            );
            const out = expectOk(res, `upload frame ${f.index}`);
            uploaded++;
            if (out.isDuplicate) duplicates++;
          }
          ev.json("framesUploaded", uploaded);
          ev.json("duplicatesDetected", duplicates);
        },
        BUDGETS.indexRepo
      );

      await ctx.step(
        "Record sidecar events (POST /api/proctoring/sessions/:id/events)",
        async (ev) => {
          const now = Date.now();
          const events = [
            { type: "window_blur", timestamp: now + 500 },
            { type: "clipboard_paste", timestamp: now + 800, metadata: { chars: 12 } },
            { type: "window_focus", timestamp: now + 1200 },
          ];
          const res = await api.post(
            `/api/proctoring/sessions/${sessionId}/events`,
            { token, events }
          );
          const out = expectOk(res, "record events");
          ev.json("recorded", out.recorded);
        }
      );

      await ctx.step(
        "Spend an arbitrary duration (parameterized)",
        async (ev) => {
          // Demonstrates "any duration" without a long real wait. The server
          // computes timeSpent from startedAt at submit time regardless.
          await new Promise((r) => setTimeout(r, CANDIDATE_DURATION_MS));
          ev.json("simulatedDurationMs", CANDIDATE_DURATION_MS);
          ev.json(
            "note",
            "Duration is parameterized via E2E_CANDIDATE_DURATION_MS; the submit path validates elapsed time against the assessment time limit server-side."
          );
        }
      );

      await ctx.step(
        "Submit code by upload (POST /token/:token/upload)",
        async (ev) => {
          const { buffer, sha256 } = await generateSampleRepoZip();
          const form = new FormData();
          form.append(
            "archive",
            new Blob([buffer], { type: "application/zip" }),
            "submission.zip"
          );
          const res = await api.postForm(
            `/api/submissions/token/${token}/upload`,
            form
          );
          const sub = expectOk(res, "upload submission");
          ev.json("status", sub.status);
          ev.json("codeSource", sub.codeSource);
          ev.json("uploadSha256", sub.codeUpload?.sha256);
          ev.json("localZipSha256", sha256);
          ev.json("timeSpentMinutes", sub.timeSpent);
          if (sub.status !== "submitted") {
            throw new Error(`expected submitted, got ${sub.status}`);
          }
        },
        BUDGETS.indexRepo
      );

      await ctx.step(
        "Complete proctoring session (POST /api/proctoring/sessions/:id/complete)",
        async (ev) => {
          const res = await api.post(
            `/api/proctoring/sessions/${sessionId}/complete`,
            { token }
          );
          const sess = expectOk(res, "complete session");
          ev.json("status", sess.status);
          ev.json(
            "note",
            "Completion triggers an eager background video merge (chunks -> playback.webm)."
          );
        }
      );

      ctx.summary(
        `Candidate completed: started, proctored (frames + events), spent a parameterized duration, and submitted via upload. Session ${sessionId} completed.`
      );
    }
  );
}
