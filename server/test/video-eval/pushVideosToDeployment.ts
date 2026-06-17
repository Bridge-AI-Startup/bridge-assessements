/**
 * Push each demo candidate's recorded video INTO the deployed backend's own
 * storage, so the merged playback file is served by the deployed dashboard.
 *
 * Mongo + Firebase are shared between local config.env and the deployment, but
 * the deployed backend (Render) reads a different blob store than the local
 * config.env S3 bucket. The transcript + scores live in Mongo (already visible),
 * but the video bytes must be uploaded THROUGH the deployment so Render merges
 * them into its own `{sessionId}/playback.webm`.
 *
 * For each candidate we: reset merge state, re-upload the webm as a chunk via
 * the candidate `/video` endpoint, call `/complete` (which merges on Render),
 * then poll `/playback-video` until it streams.
 *
 * Run: cd server && npx tsx --env-file=config.env test/video-eval/pushVideosToDeployment.ts
 */

import "../../src/config/loadEnv.js";

import fs from "fs/promises";
import path from "path";

import connectMongoose from "../../src/db/mongooseConnection.js";
import ProctoringSessionModel from "../../src/models/proctoringSession.js";
import SubmissionModel from "../../src/models/submission.js";
import { getFrameStorage } from "../../src/services/capture/storage.js";
import { RESULTS_DIR } from "../e2e/lib/evidence.js";

const RENDER_API =
  process.env.DEPLOYED_API_URL || "https://bridge-assessements-1.onrender.com";
const FIREBASE_WEB_API_KEY =
  process.env.E2E_FIREBASE_WEB_API_KEY ||
  "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo";
const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@bridgeai-demo.com").toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "BridgeDemo2026!";

const log = (m: string) => console.log(`[push-video] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a hard per-request timeout so a stalled connection can't hang the run. */
async function fetchT(
  url: string,
  opts: RequestInit,
  ms: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function mintIdToken(): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  if (!res.ok) throw new Error(`sign-in failed: ${await res.text()}`);
  return (await res.json()).idToken;
}

async function main() {
  await connectMongoose();
  const storage = getFrameStorage();
  const idToken = await mintIdToken();

  const demo = JSON.parse(
    await fs.readFile(path.join(RESULTS_DIR, "demo-account.json"), "utf-8")
  );

  const summary: any[] = [];

  for (const c of demo.candidates) {
    const sessionId: string = c.sessionId;
    const submissionId: string = c.submissionId;
    log(`--- ${c.name} (${sessionId}) ---`);

    try {
      const submission = await SubmissionModel.findById(submissionId);
      const session = await ProctoringSessionModel.findById(sessionId);
      if (!submission || !session) {
        log(`  missing submission/session, skipping`);
        continue;
      }
      const token = submission.token;

      // Skip candidates whose video already streams from the deployment (idempotent re-runs).
      try {
        const pre = await fetchT(
          `${RENDER_API}/api/proctoring/sessions/${sessionId}/playback-video`,
          { headers: { Authorization: `Bearer ${idToken}` } },
          30000
        );
        if (pre.ok) {
          const ab = await pre.arrayBuffer();
          log(`  already playable -> 200 (${ab.byteLength} bytes), skipping`);
          summary.push({
            name: c.name,
            sessionId,
            uploadStatus: "skip",
            completeStatus: "skip",
            playbackStatus: 200,
            playbackBytes: ab.byteLength,
          });
          continue;
        }
      } catch {
        /* fall through to (re)push */
      }

      // Pull the recorded webm from the local-config store (where the seeder put it).
      const buf = await storage.getVideoChunk(`${sessionId}/playback.webm`);
      log(`  pulled ${buf.length} bytes from config storage`);

      // Reset merge state so the deployed backend will (re)merge from a fresh chunk.
      session.mergedVideo = { status: "not_started", storageKey: null } as any;
      session.videoChunks = [] as any;
      session.status = "active" as any;
      await session.save();

      // 1) Upload the webm as a chunk through the deployed candidate endpoint.
      const now = Date.now();
      const form = new FormData();
      form.append("chunk", new Blob([buf], { type: "video/webm" }), "chunk.webm");
      form.append("token", token);
      form.append("screenIndex", "0");
      form.append("startTime", String(now - Math.round(c.frames ? 152000 : 60000)));
      form.append("endTime", String(now));
      const up = await fetchT(
        `${RENDER_API}/api/proctoring/sessions/${sessionId}/video`,
        { method: "POST", body: form },
        180000
      );
      log(`  upload chunk -> ${up.status}`);
      if (!up.ok) {
        log(`  upload failed: ${await up.text()}`);
      }

      // 2) Complete the session -> deployed backend merges chunks into playback.webm.
      const done = await fetchT(
        `${RENDER_API}/api/proctoring/sessions/${sessionId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        },
        60000
      );
      log(`  complete -> ${done.status}`);

      // 3) Poll playback until the deployed merge finishes and streams bytes.
      let playbackStatus = 0;
      let bytes = 0;
      for (let i = 0; i < 20; i++) {
        await sleep(4000);
        try {
          const pb = await fetchT(
            `${RENDER_API}/api/proctoring/sessions/${sessionId}/playback-video`,
            { headers: { Authorization: `Bearer ${idToken}` } },
            30000
          );
          playbackStatus = pb.status;
          if (pb.ok) {
            const ab = await pb.arrayBuffer();
            bytes = ab.byteLength;
            break;
          }
        } catch (e: any) {
          log(`  playback poll ${i} errored: ${e?.message || e}`);
        }
      }
      log(`  playback-video -> ${playbackStatus} (${bytes} bytes)`);
      summary.push({
        name: c.name,
        sessionId,
        uploadStatus: up.status,
        completeStatus: done.status,
        playbackStatus,
        playbackBytes: bytes,
      });
    } catch (e: any) {
      log(`  ERROR for ${c.name}: ${e?.message || e}`);
      summary.push({
        name: c.name,
        sessionId,
        uploadStatus: "error",
        completeStatus: "error",
        playbackStatus: 0,
        playbackBytes: 0,
        error: String(e?.message || e),
      });
    }
  }

  console.log("\n=== Deployed video playback ===");
  for (const s of summary) {
    console.log(
      `  ${String(s.name).padEnd(14)} playback=${s.playbackStatus} bytes=${s.playbackBytes}`
    );
  }

  // Persist results alongside the demo account file.
  demo.videoPlaybackOnDeployment = summary;
  await fs.writeFile(
    path.join(RESULTS_DIR, "demo-account.json"),
    JSON.stringify(demo, null, 2),
    "utf-8"
  );

  try {
    const mongoose = (await import("mongoose")).default;
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[push-video] fatal:", e);
  process.exit(1);
});
