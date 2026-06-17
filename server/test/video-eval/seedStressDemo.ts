/**
 * Run the 4 APPROVED stress videos through the REAL transcript + evaluation
 * pipeline, seed them as submissions under the existing demo recruiter account,
 * and cross-check the produced scores/descriptions against the behaviors that
 * were deliberately built into each clip.
 *
 * This is the live rate-limit / accuracy test:
 *   webm (stress-videos/<variant>.webm)
 *     -> store as {session}/playback.webm in the shared prod S3 bucket
 *     -> generateTranscript()  (ffmpeg smart-extract + GPT-4o-mini vision, many batches)
 *     -> evaluateTranscript()  (grounded criteria scoring)
 *     -> compare scores vs per-variant expected bands (ground truth)
 *
 * Writes results to server/test/results/demo-stress-results.json and verifies
 * everything is visible through the deployed Render API.
 *
 * Run:  cd server && npx tsx --env-file=config.env test/video-eval/seedStressDemo.ts
 */

import "../../src/config/loadEnv.js";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import ProctoringSessionModel from "../../src/models/proctoringSession.js";
import SubmissionModel from "../../src/models/submission.js";
import UserModel from "../../src/models/user.js";
import { getFrameStorage } from "../../src/services/capture/storage.js";
import { generateTranscript } from "../../src/ai/transcript/generator.js";
import { evaluateTranscript } from "../../src/services/evaluation/orchestrator.js";
import { proctoringJsonlToTranscriptEvents } from "../../src/services/evaluation/proctoringTranscriptAdapter.js";
import {
  refineTranscriptFromJsonl,
  storeRefinedTranscript,
} from "../../src/services/evaluation/transcriptRefinement.js";

import { withTimeout } from "../e2e/lib/runner.js";
import { RESULTS_DIR } from "../e2e/lib/evidence.js";
import { STRESS_VARIANTS, type CodingVariant } from "./humanCodingVideo.js";
import {
  overallScore,
  scoreBand,
  computeTranscriptQuality,
} from "./scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRESS_DIR = path.resolve(__dirname, "../results/stress-videos");

const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@bridgeai-demo.com").toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "BridgeDemo2026!";
const FIREBASE_WEB_API_KEY =
  process.env.E2E_FIREBASE_WEB_API_KEY ||
  "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo";
const RENDER_API =
  process.env.DEPLOYED_API_URL || "https://bridge-assessements-1.onrender.com";
const FRONTEND = process.env.DEPLOYED_FRONTEND_URL || "https://www.bridge-jobs.com";

const ASSESSMENT_TITLE =
  "Resilient Webhook Dispatcher — Live Coding Sessions (30+ min stress set)";
// 30+ min clips keep hundreds-to-thousands of frames -> many OCR/vision calls.
// The AI-heavy clip churns the most (large AI-chat crops + vision fallback), so
// the transcript budget must be generous; eval stays comparatively cheap.
const BUDGET = { transcriptMs: 90 * 60 * 1000, refineMs: 120 * 60 * 1000 };
const SKIP_REFINEMENT = process.env.SKIP_REFINEMENT === "1";
const PIPELINE_VERSION = SKIP_REFINEMENT ? "v1-raw-ocr" : "v2-time-aware";
const log = (m: string) => console.log(`[stress-demo] ${m}`);

// Criteria the evaluation pipeline scores each session against. Defined locally
// (not the shared scoring.ts EXPECTED_CRITERIA) so the single-video eval test
// keeps its own ground truth. Order matters: EXPECT[] maps by index.
const STRESS_CRITERIA = [
  "The candidate builds their solution incrementally, writing and refining code step by step across multiple files rather than pasting a finished solution.",
  "The candidate verifies their own work by running tests or linters in the terminal (e.g. pytest, ruff) and reacting to the output.",
  "The candidate relied on an AI coding assistant — AI chat, inline code completions, or inline edits (e.g. Cursor Cmd-K / Copilot) — while solving the task.",
  "The candidate opens a web browser and navigates to external pages — for example official documentation, StackOverflow, or engineering blogs — to research the problem.",
];

// Expected code tokens for transcript-quality (token recall).
const EXPECTED_TOKENS = [
  "TokenBucket",
  "backoff_delay",
  "try_acquire",
  "Dispatcher",
  "Webhook",
  "pytest",
  "async",
  "jitter",
  "Semaphore",
  "httpx",
];

type Band = "high" | "mid" | "low";
interface Expect {
  band: Band;
  strong: boolean;
  note: string;
}

// Ground truth: what was deliberately built into each clip, mapped to the 4
// STRESS_CRITERIA in order [incremental, tests-own-code, relied-on-AI, web-research].
// `strong` = unambiguous assertion counted toward the accuracy %; soft ("mid")
// assertions are reported but not scored.
const EXPECT: Record<CodingVariant, Expect[]> = {
  steady: [
    { band: "high", strong: true, note: "builds models/ratelimiter/backoff/dispatcher/api/tests module by module, typed across the clip" },
    { band: "high", strong: true, note: "runs `pytest -q` (passes) and `ruff check .` each pass" },
    { band: "mid", strong: false, note: "moderate AI: occasional chat + some inline completions / Cmd-K edits accepted" },
    { band: "high", strong: true, note: "reads the task page, then asyncio docs / StackOverflow / AWS backoff blog in the browser" },
  ],
  bursty: [
    { band: "high", strong: true, note: "fast bursts but still typed line-by-line across files (no wholesale paste)" },
    { band: "high", strong: true, note: "runs pytest each pass (pass/fail surfaced)" },
    { band: "mid", strong: false, note: "light AI: a few inline completions / Cmd-K edits, no chat panel" },
    { band: "high", strong: true, note: "long documentation/StackOverflow/blog reading sessions in the browser" },
  ],
  ai_heavy: [
    { band: "mid", strong: false, note: "accepts large AI-suggested blocks + Cmd-K diffs (semi-incremental)" },
    { band: "mid", strong: false, note: "runs pytest only on some passes" },
    { band: "high", strong: true, note: "heavy reliance: repeated AI chat prompts + many inline completions + Cmd-K inline edits" },
    { band: "high", strong: true, note: "browses docs/SO/blog every cycle alongside the AI chat" },
  ],
  debug: [
    { band: "high", strong: true, note: "iteratively edits and fixes across files (not pasted)" },
    { band: "high", strong: true, note: "edit -> pytest fail -> read traceback -> fix -> re-run green, plus git diff --stat" },
    { band: "high", strong: true, note: "uses Cmd-K to apply the backoff fix + AI chat + inline completions" },
    { band: "high", strong: true, note: "googles the failing-test traceback in the browser" },
  ],
};

function bandMatch(expected: Band, score: number, evaluable: boolean): boolean {
  const actual = scoreBand(score); // high>=6, low<=4, else mid
  if (expected === "high") return actual === "high";
  if (expected === "low") return actual === "low";
  // mid: accept the middle band (and treat non-evaluable as a non-match)
  return evaluable && score >= 4 && score <= 6;
}

async function authViaRest(): Promise<{ uid: string; idToken: string }> {
  const base = "https://identitytoolkit.googleapis.com/v1/accounts";
  const body = JSON.stringify({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    returnSecureToken: true,
  });
  const headers = { "Content-Type": "application/json" };
  const signIn = await fetch(`${base}:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers,
    body,
  });
  if (signIn.ok) {
    const b: any = await signIn.json();
    return { uid: b.localId, idToken: b.idToken };
  }
  // fall back to signup if the account doesn't exist yet
  const signUp = await fetch(`${base}:signUp?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers,
    body,
  });
  if (!signUp.ok) {
    throw new Error(`Firebase auth failed: ${await signUp.text()}`);
  }
  const b: any = await signUp.json();
  return { uid: b.localId, idToken: b.idToken };
}

async function purgePriorStressAssessment(userId: any): Promise<void> {
  const storage = getFrameStorage();
  const prior = await AssessmentModel.find({ userId, title: ASSESSMENT_TITLE });
  for (const a of prior) {
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
  if (prior.length) log(`Purged ${prior.length} prior stress assessment(s).`);
}

async function verifyThroughDeployment(idToken: string, assessmentId: string): Promise<any> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const out: any = { api: RENDER_API };
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
      out.submissionsBody = (await subs.text()).slice(0, 300);
    }
  } catch (e: any) {
    out.submissionsError = e?.message || String(e);
  }
  return out;
}

async function loadBaselineResults(): Promise<any | null> {
  const baselinePath = path.join(RESULTS_DIR, "demo-stress-results.json");
  try {
    const raw = await fs.readFile(baselinePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.pipelineVersion === "v2-time-aware" && parsed.baseline) {
      return parsed.baseline;
    }
    if (parsed.accuracy?.strongTotal) {
      return {
        strongMatched: parsed.accuracy.strongMatched,
        strongTotal: parsed.accuracy.strongTotal,
        strongAccuracy: parsed.accuracy.strongAccuracy,
        pipelineVersion: parsed.pipelineVersion ?? "v1-raw-ocr",
        candidates: parsed.candidates,
      };
    }
  } catch {
    /* no prior results */
  }
  return null;
}

/** Refine (optional) and evaluate a stored JSONL transcript. */
async function refineAndEvaluate(
  jsonl: string,
  criteria: string[],
  sessionId: string | null
): Promise<{
  events: ReturnType<typeof proctoringJsonlToTranscriptEvents>;
  report: Awaited<ReturnType<typeof evaluateTranscript>>;
  refineMs: number;
  evalMs: number;
  refined: Awaited<ReturnType<typeof refineTranscriptFromJsonl>> | null;
}> {
  const rawEvents = proctoringJsonlToTranscriptEvents(jsonl);
  if (SKIP_REFINEMENT) {
    const t0 = Date.now();
    const report = await evaluateTranscript(rawEvents, criteria);
    return {
      events: rawEvents,
      report,
      refineMs: 0,
      evalMs: Date.now() - t0,
      refined: null,
    };
  }

  const tRefine = Date.now();
  const refined = await refineTranscriptFromJsonl(jsonl);
  const refineMs = Date.now() - tRefine;
  if (sessionId) {
    await storeRefinedTranscript(sessionId, refined).catch(() => {});
  }

  const events =
    refined.evaluation_events.length > 0 ? refined.evaluation_events : rawEvents;
  const tEval = Date.now();
  const report = await evaluateTranscript(events, criteria);
  const evalMs = Date.now() - tEval;
  return { events, report, refineMs, evalMs, refined };
}

async function verifyPlayback(idToken: string, sessionId: string): Promise<any> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const out: any = {};
  try {
    const r = await fetch(`${RENDER_API}/api/proctoring/sessions/${sessionId}/playback-video`, {
      headers,
    });
    out.status = r.status;
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      out.bytes = buf.length;
    }
  } catch (e: any) {
    out.error = e?.message || String(e);
  }
  return out;
}

/** Rebuild a result entry from an already-completed submission (resume path). */
async function rebuildResultFromExisting(
  submission: any,
  session: any,
  meta: { variant: CodingVariant; label: string },
  durationSeconds: number,
  storage: ReturnType<typeof getFrameStorage>
): Promise<any> {
  const report = submission.evaluationReport;
  const variant = meta.variant;
  const expects = EXPECT[variant];

  let jsonl = "";
  try {
    if (session?.transcript?.storageKey) {
      jsonl = await storage.getTranscript(session.transcript.storageKey);
    }
  } catch {
    /* transcript may be gone; token recall just degrades */
  }
  const quality = computeTranscriptQuality(jsonl, EXPECTED_TOKENS);

  const overall10 = overallScore(report);
  const checks = report.criteria_results.map((r: any, i: number) => {
    const exp = expects[i];
    const match = bandMatch(exp.band, r.score, r.evaluable);
    return {
      criterion: r.criterion.slice(0, 70),
      expectedBand: exp.band,
      strong: exp.strong,
      intendedBehavior: exp.note,
      actualScore: r.score,
      actualBand: scoreBand(r.score),
      evaluable: r.evaluable,
      confidence: r.confidence,
      verdict: r.verdict,
      evidenceSnippet: (r.evidence?.[0]?.observation ?? r.verdict ?? "").slice(0, 180),
      match,
    };
  });
  const strongHere = checks.filter((c: any) => c.strong);
  const strongOkHere = strongHere.filter((c: any) => c.match).length;

  return {
    variant,
    label: meta.label,
    submissionId: submission._id.toString(),
    sessionId: session?._id?.toString() ?? null,
    durationSeconds,
    frames: session?.transcript?.frameCount ?? null,
    transcriptSegments: jsonl.split("\n").filter((l) => l.trim()).length,
    transcriptMs: null,
    evalMs: null,
    overallScore10: overall10,
    overallScore100: overall10 == null ? null : Math.round(overall10 * 10),
    transcriptQuality: {
      tokenRecall: quality.tokenRecall,
      foundTokens: quality.foundTokens,
      missingTokens: quality.missingTokens,
      nonEmptySegments: quality.nonEmptySegments,
    },
    summary: report.session_summary ?? null,
    checks,
    strongMatched: strongOkHere,
    strongTotal: strongHere.length,
    reusedFromPriorRun: true,
  };
}

async function main() {
  await connectMongoose();
  const storage = getFrameStorage();
  const criteria = STRESS_CRITERIA;

  // FORCE_REBUILD=1 -> purge + regenerate everything from scratch.
  // REEVAL=1        -> keep stored transcripts but re-run refinement + evaluation.
  // SKIP_REFINEMENT=1 -> score raw OCR events only (v1 path).
  // VARIANTS=a,b    -> only process these variants (parallel-safe; writes a
  //                    per-variant results file so concurrent runs don't clobber).
  const FORCE_REBUILD = process.env.FORCE_REBUILD === "1";
  const REEVAL = process.env.REEVAL === "1";
  const variantsFilter = (process.env.VARIANTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  log(
    `mode: FORCE_REBUILD=${FORCE_REBUILD} REEVAL=${REEVAL} SKIP_REFINEMENT=${SKIP_REFINEMENT} VARIANTS=${
      variantsFilter.length ? variantsFilter.join(",") : "all"
    } pipeline=${PIPELINE_VERSION}`
  );

  const baseline = await loadBaselineResults();

  const { idToken } = await authViaRest();
  const user = await UserModel.findOne({ email: DEMO_EMAIL });
  if (!user) {
    throw new Error(
      `Demo user ${DEMO_EMAIL} not found. Run seedDemoAccount.ts first.`
    );
  }
  log(`Using demo user ${user._id} (${DEMO_EMAIL}).`);

  // Idempotent: set FORCE_REBUILD=1 to purge and start clean; otherwise reuse
  // the existing assessment and only (re)process incomplete variants so a
  // re-run after an interruption doesn't redo finished 30-min clips.
  if (FORCE_REBUILD) {
    await purgePriorStressAssessment(user._id);
  }

  const assessmentFields = {
    description:
      "Full-length (30+ min) screen recordings of candidates building a resilient, " +
      "rate-limited webhook dispatcher (token bucket, exponential backoff + jitter, " +
      "bounded asyncio concurrency, FastAPI) across multiple files. Each session " +
      "exercises the editor, terminal, AI chat, in-editor AI (inline completions + " +
      "Cmd-K edits), and a browser differently. Scores below were produced by the " +
      "live transcript + evaluation pipeline; see the accuracy report for cross-checks " +
      "against the behavior deliberately built into each clip.",
    timeLimit: 90,
    numInterviewQuestions: 2,
    evaluationCriteria: criteria,
    behavioralChecks: [
      "Token bucket enforces the per-destination rate limit",
      "Backoff is capped at max_delay and uses full jitter",
    ],
  };
  let assessment = await AssessmentModel.findOne({
    userId: user._id,
    title: ASSESSMENT_TITLE,
  });
  if (assessment) {
    assessment.set(assessmentFields);
    await assessment.save();
    log(`Reusing stress assessment ${assessment._id}.`);
  } else {
    assessment = await AssessmentModel.create({
      userId: user._id,
      title: ASSESSMENT_TITLE,
      ...assessmentFields,
    });
    log(`Created stress assessment ${assessment._id}.`);
  }

  // Pull duration from the analysis file if present.
  let analysis: any = {};
  try {
    analysis = JSON.parse(
      await fs.readFile(path.join(STRESS_DIR, "stress-videos-analysis.json"), "utf-8")
    );
  } catch {
    /* optional */
  }
  const durBy: Record<string, number> = {};
  for (const v of analysis.videos ?? []) durBy[v.variant] = v.durationSeconds;

  const results: any[] = [];
  let strongMatched = 0;
  let strongTotal = 0;

  const variantsToRun = variantsFilter.length
    ? STRESS_VARIANTS.filter((v) => variantsFilter.includes(v.variant))
    : STRESS_VARIANTS;

  for (const meta of variantsToRun) {
    const variant = meta.variant;
    log(`================ ${meta.label} (${variant}) ================`);
    try {
    const candidateEmail = `${variant}@stress.bridgeai-demo.com`;
    const durationSeconds = durBy[variant] ?? 1860;

    const existing = await SubmissionModel.findOne({
      assessmentId: assessment._id,
      candidateEmail,
    });
    const existingSession = existing
      ? await ProctoringSessionModel.findOne({ submissionId: existing._id })
      : null;
    const transcriptReusable =
      !FORCE_REBUILD &&
      existingSession?.transcript?.status === "completed" &&
      !!existingSession?.transcript?.storageKey;

    // Resume (default): a finished clip with a stored evaluation is reused as-is
    // unless REEVAL=1 asks us to re-score it (cheaply) with the fixed evaluator.
    if (
      existing &&
      (existing as any).evaluationReport?.criteria_results?.length &&
      !REEVAL &&
      !FORCE_REBUILD
    ) {
      const rebuilt = await rebuildResultFromExisting(
        existing,
        existingSession,
        meta,
        durationSeconds,
        storage
      );
      for (const c of rebuilt.checks) {
        if (c.strong) {
          strongTotal++;
          if (c.match) strongMatched++;
        }
      }
      results.push(rebuilt);
      log(`[${variant}] already complete — reused (overall ${rebuilt.overallScore10 ?? "n/a"}/10, strong ${rebuilt.strongMatched}/${rebuilt.strongTotal}).`);
      continue;
    }

    let submission: any;
    let session: any;
    let sessionId: string;
    let transcript: { frameCount: number; storageKey: string };
    let transcriptMs: number;

    if (transcriptReusable) {
      // Reuse the already-generated transcript (expensive to recreate) and only
      // re-run evaluation. Frees ~37 min/clip when iterating on the evaluator.
      submission = existing;
      session = existingSession;
      sessionId = session._id.toString();
      transcript = {
        frameCount: session.transcript.frameCount ?? 0,
        storageKey: session.transcript.storageKey,
      };
      transcriptMs = 0;
      log(`[${variant}] reusing stored transcript (${transcript.frameCount} frames); re-evaluating only.`);
    } else {
      // Partial/stale/forced: clean it up before a fresh full run.
      if (existing) {
        const sessions = await ProctoringSessionModel.find({ submissionId: existing._id });
        for (const sess of sessions) {
          try {
            const keys = await storage.listKeys(`${sess._id}/`);
            for (const k of keys) await storage.delete(k).catch(() => {});
          } catch {
            /* best effort */
          }
        }
        await ProctoringSessionModel.deleteMany({ submissionId: existing._id });
        await SubmissionModel.deleteOne({ _id: existing._id });
        log(`[${variant}] removed a partial/stale submission before reprocessing.`);
      }

      const webmPath = path.join(STRESS_DIR, `${variant}.webm`);
      const buffer = await fs.readFile(webmPath);
      const start = Date.now() - durationSeconds * 1000;

      submission = await SubmissionModel.create({
        assessmentId: assessment._id,
        candidateName: meta.label,
        candidateEmail,
        status: "submitted",
        submittedAt: new Date(),
        startedAt: new Date(start),
        timeSpent: Math.round(durationSeconds / 60),
        codeSource: "upload",
        codeUpload: {
          storageKey: `demo/stress-${variant}.zip`,
          originalFilename: "submission.zip",
          sizeBytes: buffer.length,
          sha256: crypto.createHash("sha256").update(variant).digest("hex"),
          uploadedAt: new Date(),
        },
        metadata: { ipAddress: "stress-demo", userAgent: "seed-stress-demo" },
      });

      session = await ProctoringSessionModel.create({
        submissionId: submission._id,
        token: submission.token,
        status: "completed",
        consent: { granted: true, grantedAt: new Date(start), screens: 1 },
        screens: [{ screenIndex: 0, label: "Screen 1", width: 1280, height: 720 }],
        stats: {
          captureStartedAt: new Date(start),
          captureEndedAt: new Date(),
          videoStats: { durationSeconds },
        },
      });
      sessionId = session._id.toString();

      const playbackKey = `${sessionId}/playback.webm`;
      await storage.storeVideoChunk(playbackKey, buffer);
      session.mergedVideo = {
        status: "ready",
        storageKey: playbackKey,
        sizeBytes: buffer.length,
        durationSeconds,
        mergedAt: new Date(),
      } as any;
      session.videoChunks = [] as any;
      await session.save();

      log(`[${variant}] generating transcript (live vision pipeline)...`);
      const tTrans = Date.now();
      transcript = await withTimeout(
        generateTranscript(sessionId),
        BUDGET.transcriptMs,
        `transcript:${variant}`
      );
      transcriptMs = Date.now() - tTrans;
      log(`[${variant}] transcript: ${transcript.frameCount} frames in ${(transcriptMs / 1000).toFixed(0)}s`);
    }

    const jsonl = await storage.getTranscript(transcript.storageKey);
    const quality = computeTranscriptQuality(jsonl, EXPECTED_TOKENS);

    log(`[${variant}] refining + evaluating (${PIPELINE_VERSION})...`);
    const tPipe = Date.now();
    const { events, report, refineMs, evalMs, refined } = await withTimeout(
      refineAndEvaluate(jsonl, criteria, sessionId),
      BUDGET.refineMs,
      `refine-eval:${variant}`
    );
    const pipeMs = Date.now() - tPipe;
    log(
      `[${variant}] pipeline done in ${(pipeMs / 1000).toFixed(0)}s ` +
        `(refine ${(refineMs / 1000).toFixed(0)}s, eval ${(evalMs / 1000).toFixed(0)}s, ` +
        `${refined?.evaluation_events.length ?? events.length} eval events)`
    );

    const overall10 = overallScore(report);
    const overall100 = overall10 == null ? null : Math.round(overall10 * 10);

    (submission as any).screenRecordingTranscript = events;
    if (refined) {
      (submission as any).enrichedTranscript = refined.enriched;
      (submission as any).refinedTranscript = refined;
    }
    (submission as any).evaluationReport = report;
    (submission as any).evaluationStatus = "completed";
    (submission as any).evaluationError = null;
    (submission as any).scores = {
      overall: overall100,
      calculatedAt: new Date(),
      calculationVersion: SKIP_REFINEMENT ? "stress-demo-v1" : "stress-demo-v2",
    };
    await submission.save();

    // Cross-check against the intended behavior.
    const expects = EXPECT[variant];
    const checks = report.criteria_results.map((r, i) => {
      const exp = expects[i];
      const match = bandMatch(exp.band, r.score, r.evaluable);
      if (exp.strong) {
        strongTotal++;
        if (match) strongMatched++;
      }
      return {
        criterion: r.criterion.slice(0, 70),
        expectedBand: exp.band,
        strong: exp.strong,
        intendedBehavior: exp.note,
        actualScore: r.score,
        actualBand: scoreBand(r.score),
        evaluable: r.evaluable,
        confidence: r.confidence,
        verdict: r.verdict,
        evidenceSnippet: (r.evidence?.[0]?.observation ?? r.verdict ?? "").slice(0, 180),
        match,
      };
    });

    const strongHere = checks.filter((c) => c.strong);
    const strongOkHere = strongHere.filter((c) => c.match).length;
    log(
      `[${variant}] overall=${overall10 ?? "n/a"}/10 | strong checks ${strongOkHere}/${strongHere.length} | ` +
        `tokenRecall=${(quality.tokenRecall * 100).toFixed(0)}% | ${transcript.frameCount} frames`
    );

    results.push({
      variant,
      label: meta.label,
      submissionId: submission._id.toString(),
      sessionId,
      durationSeconds,
      frames: transcript.frameCount,
      transcriptSegments: jsonl.split("\n").filter((l) => l.trim()).length,
      transcriptMs,
      refineMs,
      evalMs,
      overallScore10: overall10,
      overallScore100: overall100,
      transcriptQuality: {
        tokenRecall: quality.tokenRecall,
        foundTokens: quality.foundTokens,
        missingTokens: quality.missingTokens,
        nonEmptySegments: quality.nonEmptySegments,
      },
      summary: report.session_summary ?? null,
      checks,
      strongMatched: strongOkHere,
      strongTotal: strongHere.length,
      pipelineVersion: PIPELINE_VERSION,
      evalEventCount: events.length,
      temporalInsightCount: refined?.temporal_insights.length ?? 0,
    });
    } catch (e: any) {
      log(`[${variant}] FAILED: ${e?.message || String(e)}`);
      results.push({
        variant,
        label: meta.label,
        error: String(e?.message || e),
        overallScore10: null,
        strongMatched: 0,
        strongTotal: 0,
      });
    }
  }

  log("Verifying through deployed Render API...");
  const deployment = await verifyThroughDeployment(idToken, assessment._id.toString());
  const playback: any[] = [];
  for (const r of results) {
    if (!r.sessionId) continue;
    playback.push({ variant: r.variant, sessionId: r.sessionId, ...(await verifyPlayback(idToken, r.sessionId)) });
  }

  const accuracy = strongTotal === 0 ? 0 : strongMatched / strongTotal;
  const out: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    pipelineVersion: PIPELINE_VERSION,
    login: { url: `${FRONTEND}/`, email: DEMO_EMAIL, password: DEMO_PASSWORD },
    userId: user._id.toString(),
    assessmentId: assessment._id.toString(),
    assessmentTitle: ASSESSMENT_TITLE,
    baseline: baseline ?? {
      strongMatched: 6,
      strongTotal: 12,
      strongAccuracy: 0.5,
      pipelineVersion: "v1-raw-ocr",
      note: "Hardcoded fallback if no prior demo-stress-results.json",
    },
    v2: {
      strongMatched,
      strongTotal,
      strongAccuracy: accuracy,
      pipelineVersion: PIPELINE_VERSION,
    },
    accuracy: {
      strongMatched,
      strongTotal,
      strongAccuracy: accuracy,
      note: "Accuracy is over the 'strong' (unambiguous) ground-truth assertions per clip. 'mid'/soft assertions are reported but not scored.",
    },
    candidates: results,
    deploymentVerification: deployment,
    videoPlaybackOnDeployment: playback,
  };

  const outName = variantsFilter.length
    ? `demo-stress-results.${variantsFilter.join("-")}.json`
    : "demo-stress-results.json";
  const outPath = path.join(RESULTS_DIR, outName);
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf-8");

  console.log("\n========================================================");
  console.log(" STRESS VIDEOS — LIVE PIPELINE on DEMO ACCOUNT");
  console.log("========================================================");
  console.log(` Login     : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(` Assessment: ${ASSESSMENT_TITLE} (${assessment._id})`);
  for (const r of results) {
    if (r.error) {
      console.log(`   - ${r.label.padEnd(16)} FAILED: ${r.error}`);
      continue;
    }
    console.log(
      `   - ${r.label.padEnd(16)} overall ${String(r.overallScore10 ?? "n/a").padEnd(4)}/10  ` +
        `strong ${r.strongMatched}/${r.strongTotal}  ${r.frames} frames  recall ${(r.transcriptQuality.tokenRecall * 100).toFixed(0)}%`
    );
  }
  console.log(` STRONG ACCURACY: ${strongMatched}/${strongTotal} (${(accuracy * 100).toFixed(0)}%)`);
  console.log(` Deployment: ${JSON.stringify(deployment)}`);
  console.log(` Details   : ${outPath}`);
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
  console.error("[stress-demo] fatal:", e);
  process.exit(1);
});
