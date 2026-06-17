/**
 * Verify stress demo submissions are production-normal across Mongo, S3, Firebase, Render API.
 * Run: cd server && npx tsx --env-file=config.env test/video-eval/verifyStressDeployment.ts
 */

import "../../src/config/loadEnv.js";

import connectMongoose from "../../src/db/mongooseConnection.js";
import SubmissionModel from "../../src/models/submission.js";
import ProctoringSessionModel from "../../src/models/proctoringSession.js";
import UserModel from "../../src/models/user.js";
import { getFrameStorage } from "../../src/services/capture/storage.js";

const RENDER_API =
  process.env.DEPLOYED_API_URL || "https://bridge-assessements-1.onrender.com";
const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@bridgeai-demo.com").toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "BridgeDemo2026!";
const FIREBASE_KEY =
  process.env.E2E_FIREBASE_WEB_API_KEY ||
  "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo";
const ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";

async function main() {
  await connectMongoose();
  const storage = getFrameStorage();
  let ok = true;

  const user = await UserModel.findOne({ email: DEMO_EMAIL });
  console.log(
    user?.firebaseUid
      ? `✓ Firebase user linked in Mongo (${user.firebaseUid.slice(0, 8)}…)`
      : "✗ Missing firebaseUid on demo user"
  );
  if (!user?.firebaseUid) ok = false;

  const subs = await SubmissionModel.find({ assessmentId: ASSESSMENT_ID }).sort({
    candidateEmail: 1,
  });
  console.log(`\nMongo submissions: ${subs.length}`);
  for (const s of subs) {
    const sess = await ProctoringSessionModel.findOne({ submissionId: s._id });
    const merged = (sess as any)?.mergedVideo;
    const transcript = (sess as any)?.transcript;
    const sid = sess?._id?.toString() ?? "?";
    const chunkCount = (sess as any)?.videoChunks?.length ?? 0;
    let s3Playback = false;
    let s3Transcript = false;
    if (sess) {
      const playbackKey =
        merged?.status === "ready" && merged?.storageKey
          ? merged.storageKey
          : `${sid}/playback.webm`;
      try {
        const buf = await storage.getVideoChunk(playbackKey);
        s3Playback = buf.length > 0;
      } catch {
        /* */
      }
    }
    if (transcript?.storageKey) {
      try {
        const t = await storage.getTranscript(transcript.storageKey);
        s3Transcript = t.length > 0;
      } catch {
        /* */
      }
    }
    const videoOk =
      merged?.status === "ready" || chunkCount > 0 || s3Playback;
    const line =
      `${s.candidateEmail}: status=${s.status} score=${(s as any).scores?.overall ?? "—"} ` +
      `eval=${(s as any).evaluationStatus} merged=${merged?.status} chunks=${chunkCount} ` +
      `s3Video=${s3Playback} s3Transcript=${s3Transcript}`;
    const good =
      s.status === "submitted" &&
      (s as any).evaluationStatus === "completed" &&
      videoOk &&
      s3Transcript;
    console.log(good ? `✓ ${line}` : `✗ ${line}`);
    if (!good) ok = false;
  }

  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
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
  if (!authRes.ok) {
    console.log("\n✗ Firebase sign-in failed");
    ok = false;
    process.exit(1);
  }
  const { idToken } = await authRes.json();
  console.log("\n✓ Firebase sign-in OK");

  const dash = await fetch(
    `${RENDER_API}/api/submissions/assessments/${ASSESSMENT_ID}/submissions`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  const body = await dash.json();
  const list = Array.isArray(body) ? body : body.submissions ?? [];
  console.log(`\nDashboard API (${dash.status}): ${list.length} submissions`);
  for (const s of list) {
    const sessId =
      s.proctoringSessionId ||
      s.proctoringSession?._id ||
      (
        await ProctoringSessionModel.findOne({ submissionId: s._id })
      )?._id?.toString();
    let playback = "missing session";
    if (sessId) {
      const pb = await fetch(
        `${RENDER_API}/api/proctoring/sessions/${sessId}/playback-video`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (pb.ok) {
        const bytes = (await pb.arrayBuffer()).byteLength;
        playback = `200 (${(bytes / 1e6).toFixed(1)} MB)`;
      } else {
        playback = String(pb.status);
        ok = false;
      }
    }
    const hasScores = !!s.evaluationReport?.criteria_results?.length;
    console.log(
      hasScores && playback.startsWith("200")
        ? `✓ ${s.candidateEmail} playback=${playback}`
        : `✗ ${s.candidateEmail} playback=${playback} hasReport=${hasScores}`
    );
    if (!hasScores) ok = false;
  }

  console.log(ok ? "\n=== ALL CHECKS PASSED ===" : "\n=== SOME CHECKS FAILED ===");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
