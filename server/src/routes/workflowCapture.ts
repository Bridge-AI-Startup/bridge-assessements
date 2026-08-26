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
import * as WorkflowCaptureDevController from "../controllers/workflowCaptureDev.js";
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

// --- Dev-only live lab (never mounted in production) ---
// The lab shows raw capture data AND runs every AI stage on demand, so it is
// gated here and re-checked inside each handler.
if (process.env.NODE_ENV !== "production") {
  router.get("/tester", (_req, res) => {
    res.type("html").send(renderTesterPage());
  });
  router.get("/dev/data", WorkflowCaptureDevController.getLabData);
  router.get("/dev/file", WorkflowCaptureDevController.getLabFile);
  router.get("/dev/stage/:stage", WorkflowCaptureDevController.getLabStage);
  router.post("/dev/run/:stage", express.json({ limit: "1mb" }), WorkflowCaptureDevController.runLabStage);
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
