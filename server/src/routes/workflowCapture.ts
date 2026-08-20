/**
 * /api/workflow-capture — hooks-first AI-collaboration capture.
 *
 * Candidate-side (Bearer capture token, no Firebase auth): the capture kit
 * running inside their AI tool's hooks.
 * Agent-side (X-Agent-Secret): live context for the ElevenLabs interviewer.
 * Employer-side (Firebase auth): review the captured timeline.
 */

import express from "express";
import multer from "multer";
import os from "os";

import * as WorkflowCaptureController from "../controllers/workflowCapture.js";
import {
  handleCandidateMessagesProxy,
  handleCandidateCountTokensProxy,
  handleCandidateLlmUsage,
} from "../services/candidateLlmProxy.js";
import { verifyAuthToken } from "../validators/auth.js";
import { renderTesterPage } from "../services/workflowCapture/testerPage.js";

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, product: "workflow-capture" });
});

// --- Candidate capture kit (Bearer capture token) ---
router.post("/sessions", WorkflowCaptureController.createCaptureSession);
router.post("/events", WorkflowCaptureController.ingestEvents);
router.post("/snapshot", WorkflowCaptureController.ingestSnapshot);
router.post("/complete", WorkflowCaptureController.completeCaptureSession);
// Transparency: the candidate can read back their own captured record.
router.get("/me", WorkflowCaptureController.getOwnCaptureRecord);

// --- Candidate LLM proxy (Bearer llm proxy token; Bridge-provided AI credits) ---
// The capture kit writes ANTHROPIC_BASE_URL=<api>/api/workflow-capture/llm into
// .claude/settings.json; Claude Code appends /v1/messages. Calls run on the org
// Anthropic key, metered against the assessment's candidateLlmCredits, and each
// writes an LlmProxyCall receipt (the tamper-proof record the hook stream is
// cross-checked against).
router.post("/llm/v1/messages", (req, res, next) => {
  handleCandidateMessagesProxy(req, res).catch(next);
});
router.post("/llm/v1/messages/count_tokens", (req, res, next) => {
  handleCandidateCountTokensProxy(req, res).catch(next);
});
router.get("/llm/usage", (req, res, next) => {
  handleCandidateLlmUsage(req, res).catch(next);
});

// --- Screen recording attached to the capture session (Bearer capture token) ---
// Chunks go to disk, never the heap: a 50MB timeslice per in-flight request is
// exactly what OOMed the proctoring pipeline.
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single("chunk");

router.post("/video/start", WorkflowCaptureController.startVideo);
router.post("/video/chunk", videoUpload, WorkflowCaptureController.uploadVideoChunk);
router.post("/video/stop", WorkflowCaptureController.stopVideo);
// Playback is open in dev (the local tester has no login) and employer-auth'd
// in production, where the handler additionally checks ownership.
const authInProduction: express.RequestHandler = (req, res, next) =>
  process.env.NODE_ENV === "production"
    ? (verifyAuthToken as express.RequestHandler)(req, res, next)
    : next();

router.get(
  "/sessions/:id/video",
  authInProduction,
  WorkflowCaptureController.streamSessionVideo
);

// --- Analysis (employer auth + ownership) ---
// These return the candidate's prompts and code, and trigger paid model calls;
// they were briefly mounted unauthenticated.
router.get(
  "/sessions/:id/analysis",
  verifyAuthToken,
  WorkflowCaptureController.getSessionAnalysis
);
router.post(
  "/sessions/:id/classify-screen",
  verifyAuthToken,
  WorkflowCaptureController.runScreenClassification
);
router.get(
  "/sessions/by-submission/:submissionId",
  verifyAuthToken,
  WorkflowCaptureController.getCaptureSessionBySubmission
);

// --- Dev-only live tester (never mounted in production) ---
if (process.env.NODE_ENV !== "production") {
  router.get("/tester", (_req, res) => {
    res.type("html").send(renderTesterPage());
  });
  router.get("/dev/data", WorkflowCaptureController.getDevTesterData);
}

// --- Live interviewer agent (X-Agent-Secret) ---
router.get("/agent-context", WorkflowCaptureController.getAgentContext);

// --- Employer review (Firebase auth) ---
router.get(
  "/sessions/:id",
  verifyAuthToken,
  WorkflowCaptureController.getCaptureSessionForReview
);

export default router;
