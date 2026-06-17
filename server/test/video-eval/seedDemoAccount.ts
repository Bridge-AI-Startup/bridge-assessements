/**
 * Seed a real, login-ready DEMO recruiter account into the deployed stack
 * (the services configured in server/config.env: Firebase + MongoDB Atlas + S3).
 *
 * Creates:
 *   - a Firebase Auth user (email + password) you can log in with
 *   - the matching Mongo User (subscription active, so nothing is paywalled)
 *   - one assessment with real evaluation criteria
 *   - one submission per candidate profile, each with a real recorded coding
 *     video and scores produced by the ACTUAL transcript + evaluation pipeline
 *
 * It then verifies the account + data are visible THROUGH THE DEPLOYED BACKEND
 * (Render) using a real signed-in ID token, so you can trust the dashboard.
 *
 * Run:  cd server && npx tsx --env-file=config.env test/video-eval/seedDemoAccount.ts
 *
 * This writes to the configured (production) database and is intentionally
 * persistent — it does NOT clean up. Re-running refreshes the same account.
 */

import "../../src/config/loadEnv.js";

import crypto from "crypto";
import fs from "fs/promises";
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
import { RESULTS_DIR } from "../e2e/lib/evidence.js";
import {
  CANDIDATE_VARIANTS,
  generateCodingVideo,
} from "./codingVideoFixture.js";
import { EXPECTED_CRITERIA, overallScore, scoreBand } from "./scoring.js";

const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@bridgeai-demo.com").toLowerCase();
// Fixed by default so re-runs can sign back in (we create the Firebase user via
// the Identity Toolkit REST API, which has no admin-side password reset here).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "BridgeDemo2026!";
const COMPANY = process.env.DEMO_COMPANY || "BridgeAI Demo";
const FIREBASE_WEB_API_KEY =
  process.env.E2E_FIREBASE_WEB_API_KEY ||
  "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo";
const RENDER_API =
  process.env.DEPLOYED_API_URL || "https://bridge-assessements-1.onrender.com";
const FRONTEND = process.env.DEPLOYED_FRONTEND_URL || "https://www.bridge-jobs.com";

const BUDGET = { transcriptMs: 8 * 60 * 1000, evalMs: 4 * 60 * 1000 };
const log = (m: string) => console.log(`[seed-demo] ${m}`);

function candidateEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@candidates.bridgeai-demo.com`;
}

/**
 * Create (or sign back into) the Firebase Auth user via the Identity Toolkit
 * REST API. Unlike the Admin SDK, Google signs the token server-side, so this
 * works regardless of local clock skew. Returns the uid + a valid ID token.
 */
async function authViaRest(): Promise<{ uid: string; idToken: string }> {
  const base = "https://identitytoolkit.googleapis.com/v1/accounts";
  const body = JSON.stringify({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    returnSecureToken: true,
  });
  const headers = { "Content-Type": "application/json" };

  const signUp = await fetch(`${base}:signUp?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers,
    body,
  });
  if (signUp.ok) {
    const b: any = await signUp.json();
    log(`Created Firebase user ${b.localId} via REST signup.`);
    return { uid: b.localId, idToken: b.idToken };
  }
  const errText = await signUp.text();
  if (!/EMAIL_EXISTS/.test(errText)) {
    throw new Error(`Firebase signUp failed: ${signUp.status} ${errText}`);
  }

  const signIn = await fetch(
    `${base}:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
    { method: "POST", headers, body }
  );
  if (!signIn.ok) {
    throw new Error(
      `Firebase user exists but sign-in failed (password mismatch?). ` +
        `Set DEMO_PASSWORD to the original. ${await signIn.text()}`
    );
  }
  const b: any = await signIn.json();
  log(`Reusing existing Firebase user ${b.localId} (signed in).`);
  return { uid: b.localId, idToken: b.idToken };
}

async function purgePriorData(firebaseUid: string): Promise<void> {
  const storage = getFrameStorage();
  const users = await UserModel.find({
    $or: [{ email: DEMO_EMAIL }, { firebaseUid }],
  });
  for (const u of users) {
    const assessments = await AssessmentModel.find({ userId: u._id });
    for (const a of assessments) {
      const subs = await SubmissionModel.find({ assessmentId: a._id });
      for (const s of subs) {
        const sessions = await ProctoringSessionModel.find({ submissionId: s._id });
        for (const sess of sessions) {
          try {
            const keys = await storage.listKeys(`${sess._id}/`);
            for (const k of keys) await storage.delete(k).catch(() => {});
          } catch {
            /* best effort */
          }
        }
        await ProctoringSessionModel.deleteMany({ submissionId: s._id });
      }
      await SubmissionModel.deleteMany({ assessmentId: a._id });
      await AssessmentModel.deleteOne({ _id: a._id });
    }
    await UserModel.deleteOne({ _id: u._id });
  }
  if (users.length) log(`Purged prior demo data for ${users.length} user doc(s).`);
}

async function verifyThroughDeployment(
  idToken: string,
  assessmentId: string
): Promise<any> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const out: any = { api: RENDER_API };
  try {
    const who = await fetch(`${RENDER_API}/api/users/whoami`, { headers });
    out.whoamiStatus = who.status;
    out.whoami = who.ok ? await who.json() : await who.text();
  } catch (e: any) {
    out.whoamiError = e?.message || String(e);
  }
  try {
    const subs = await fetch(
      `${RENDER_API}/api/submissions/assessments/${assessmentId}/submissions`,
      { headers }
    );
    out.submissionsStatus = subs.status;
    if (subs.ok) {
      const body: any = await subs.json();
      const list = Array.isArray(body) ? body : body.submissions ?? [];
      out.submissionsVisible = list.length;
      out.submissionsWithScores = list.filter(
        (s: any) => s.evaluationReport?.criteria_results?.length
      ).length;
    } else {
      out.submissionsBody = await subs.text();
    }
  } catch (e: any) {
    out.submissionsError = e?.message || String(e);
  }
  return out;
}

async function main() {
  await connectMongoose();
  const criteria = EXPECTED_CRITERIA.map((c) => c.criterion);
  const storage = getFrameStorage();

  const { uid: firebaseUid, idToken } = await authViaRest();
  await purgePriorData(firebaseUid);

  const user = await UserModel.create({
    firebaseUid,
    email: DEMO_EMAIL,
    companyName: COMPANY,
    subscriptionStatus: "active",
    currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    subscription: {
      tier: "paid",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    },
  });
  log(`Created Mongo user ${user._id} (subscription active).`);

  const assessment = await AssessmentModel.create({
    userId: user._id,
    title: "Prime Numbers Kata — Take-Home",
    description:
      "Implement prime-number utilities in Python: is_prime(n) and " +
      "primes_up_to(limit). Write tests and make them pass. We evaluate how you " +
      "work, not just the final code.",
    timeLimit: 60,
    numInterviewQuestions: 2,
    evaluationCriteria: criteria,
    behavioralChecks: [
      "is_prime correctly rejects numbers below 2",
      "primes_up_to returns the primes in range",
    ],
  });
  log(`Created assessment ${assessment._id}.`);

  const candidates: any[] = [];

  for (const v of CANDIDATE_VARIANTS) {
    log(`--- Candidate: ${v.name} (${v.variant}) ---`);
    const video = await generateCodingVideo({ targetSeconds: 150, variant: v.variant });

    const start = Date.now() - video.durationSeconds * 1000;
    const submission = await SubmissionModel.create({
      assessmentId: assessment._id,
      candidateName: v.name,
      candidateEmail: candidateEmail(v.name),
      status: "submitted",
      submittedAt: new Date(),
      startedAt: new Date(start),
      timeSpent: Math.round(video.durationSeconds / 60),
      codeSource: "upload",
      codeUpload: {
        storageKey: `demo/${v.variant}.zip`,
        originalFilename: "submission.zip",
        sizeBytes: 2048,
        sha256: crypto.createHash("sha256").update(v.variant).digest("hex"),
        uploadedAt: new Date(),
      },
      metadata: { ipAddress: "demo", userAgent: "seed-demo" },
    });

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
        videoStats: { durationSeconds: video.durationSeconds },
      },
    });
    const sessionId = session._id.toString();

    // Store as the merged playback file so the dashboard can play it back, and
    // so transcript generation uses the same ffmpeg extraction path as prod.
    const playbackKey = `${sessionId}/playback.webm`;
    await storage.storeVideoChunk(playbackKey, video.buffer);
    session.mergedVideo = {
      status: "ready",
      storageKey: playbackKey,
      sizeBytes: video.buffer.length,
      durationSeconds: video.durationSeconds,
      mergedAt: new Date(),
    } as any;
    session.videoChunks = [] as any;
    await session.save();
    await video.cleanup();

    log(`Generating transcript (real pipeline) for ${v.name}...`);
    const tTrans = Date.now();
    const transcript = await withTimeout(
      generateTranscript(sessionId),
      BUDGET.transcriptMs,
      `transcript:${v.variant}`
    );
    const transcriptMs = Date.now() - tTrans;

    const jsonl = await storage.getTranscript(transcript.storageKey);
    const events = proctoringJsonlToTranscriptEvents(jsonl);

    log(`Evaluating transcript for ${v.name}...`);
    const tEval = Date.now();
    const report = await withTimeout(
      evaluateTranscript(events, criteria),
      BUDGET.evalMs,
      `eval:${v.variant}`
    );
    const evalMs = Date.now() - tEval;

    const overall10 = overallScore(report); // 1-10 over evaluable criteria
    const overall100 = overall10 == null ? null : Math.round(overall10 * 10);

    (submission as any).screenRecordingTranscript = events;
    (submission as any).evaluationReport = report;
    (submission as any).evaluationStatus = "completed";
    (submission as any).evaluationError = null;
    (submission as any).scores = {
      overall: overall100,
      calculatedAt: new Date(),
      calculationVersion: "demo-seed-v1",
    };
    await submission.save();

    const perCriterion = report.criteria_results.map((r) => ({
      criterion: r.criterion.slice(0, 60),
      score: r.score,
      band: scoreBand(r.score),
      evaluable: r.evaluable,
    }));
    candidates.push({
      name: v.name,
      profile: v.label,
      variant: v.variant,
      submissionId: submission._id.toString(),
      sessionId,
      overallScore10: overall10,
      overallScore100: overall100,
      frames: transcript.frameCount,
      transcriptSegments: jsonl.split("\n").filter((l) => l.trim()).length,
      transcriptMs,
      evalMs,
      perCriterion,
    });
    log(
      `${v.name}: overall=${overall10 ?? "n/a"}/10 | ${perCriterion
        .map((p) => `${p.score}(${p.band})`)
        .join(" ")} | ${transcript.frameCount} frames`
    );
  }

  // Verify the account + data are reachable through the DEPLOYED backend.
  log("Verifying login + data through the deployed Render API...");
  const deployment: any = {
    signInOk: true,
    ...(await verifyThroughDeployment(idToken, assessment._id.toString())),
  };

  const result = {
    generatedAt: new Date().toISOString(),
    login: {
      url: `${FRONTEND}/`,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      note: "Sign in on the deployed site, then open the assessment to view submissions.",
    },
    firebaseUid,
    userId: user._id.toString(),
    assessmentId: assessment._id.toString(),
    assessmentTitle: assessment.title,
    candidates,
    deploymentVerification: deployment,
  };

  const outPath = path.join(RESULTS_DIR, "demo-account.json");
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf-8");

  console.log("\n========================================================");
  console.log(" BridgeAI DEMO ACCOUNT (deployed)");
  console.log("========================================================");
  console.log(` Login URL : ${result.login.url}`);
  console.log(` Email     : ${result.login.email}`);
  console.log(` Password  : ${result.login.password}`);
  console.log(` Assessment: ${result.assessmentTitle} (${result.assessmentId})`);
  console.log(" Candidates / system-generated scores:");
  for (const c of candidates) {
    console.log(
      `   - ${c.name.padEnd(14)} ${String(c.profile).padEnd(20)} overall ${
        c.overallScore10 ?? "n/a"
      }/10  [${c.perCriterion.map((p: any) => `${p.score}`).join(", ")}]`
    );
  }
  console.log(` Deployment verify: ${JSON.stringify(deployment)}`);
  console.log(` Details: ${outPath}`);
  console.log("========================================================\n");

  try {
    const mongoose = (await import("mongoose")).default;
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-demo] fatal:", e);
  process.exit(1);
});
