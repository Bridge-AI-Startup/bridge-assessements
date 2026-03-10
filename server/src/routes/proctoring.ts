import express from "express";
import multer from "multer";

import * as ProctoringController from "../controllers/proctoring.js";
import * as ProctoringValidator from "../validators/proctoringValidation.js";
import { verifyAuthToken, optionalAuthToken } from "../validators/auth.js";

const router = express.Router();

const frameUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
}).single("frame");

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).single("chunk");

// Dev-only test endpoint (must be before :sessionId param routes)
router.post(
  "/sessions/test/create",
  ProctoringController.createTestSession
);

// Paste raw JSONL transcript → get both interpretation strategies (chunked + stateful)
router.post(
  "/interpret-raw-transcript",
  ProctoringValidator.interpretRawTranscriptValidation,
  ProctoringController.interpretRawTranscript
);

// Render overlay PNG from regions + dimensions (no detection; use with already-loaded frame data)
router.post(
  "/render-overlay",
  ProctoringValidator.renderOverlayValidation,
  ProctoringController.renderOverlay
);

// Candidate endpoints (token-based, no Firebase auth)

router.post(
  "/sessions",
  ProctoringValidator.createSessionValidation,
  ProctoringController.createSession
);

router.post(
  "/sessions/:sessionId/consent",
  ProctoringValidator.grantConsentValidation,
  ProctoringController.grantConsent
);

router.post(
  "/sessions/:sessionId/frames",
  frameUpload,
  ProctoringController.uploadFrame
);

router.post(
  "/sessions/:sessionId/frames/batch",
  ProctoringValidator.uploadBatchValidation,
  ProctoringController.uploadFrameBatch
);

router.post(
  "/sessions/:sessionId/events",
  ProctoringValidator.sidecarEventValidation,
  ProctoringController.recordSidecarEvents
);

router.post(
  "/sessions/:sessionId/complete",
  ProctoringValidator.completeSessionValidation,
  ProctoringController.completeSession
);

router.post(
  "/sessions/:sessionId/video",
  videoUpload,
  ProctoringController.uploadVideoChunk
);

// Shared endpoints (employer or candidate)

router.get(
  "/sessions/:sessionId",
  ProctoringController.getSession
);

router.get(
  "/sessions/:sessionId/transcript",
  ProctoringController.getTranscript
);

// Companion (in-session voice transcript) — candidate token or employer auth
router.post(
  "/sessions/:sessionId/companion/prompt",
  ProctoringValidator.companionPromptValidation,
  ProctoringController.getCompanionPrompt
);
router.post(
  "/sessions/:sessionId/companion/messages",
  ProctoringValidator.companionMessagesValidation,
  ProctoringController.recordCompanionMessages
);
router.get(
  "/sessions/:sessionId/companion/transcript",
  optionalAuthToken,
  ProctoringValidator.getCompanionTranscriptValidation,
  ProctoringController.getCompanionTranscript
);

// Employer endpoints (auth required)

const transcriptAuthMiddleware =
  process.env.NODE_ENV === "production" ? [verifyAuthToken] : [];

router.post(
  "/sessions/:sessionId/generate-transcript",
  ...transcriptAuthMiddleware,
  ProctoringValidator.generateTranscriptValidation,
  ProctoringController.generateSessionTranscript
);

router.post(
  "/sessions/:sessionId/interpret-transcript",
  ...transcriptAuthMiddleware,
  ProctoringController.interpretSessionTranscript
);

router.get(
  "/sessions/:sessionId/debug-frames",
  ProctoringController.getDebugFrames
);

router.get(
  "/sessions/:sessionId/export-overlays",
  ProctoringController.exportSessionOverlays
);

router.get(
  "/sessions/by-submission/:submissionId",
  [verifyAuthToken],
  ProctoringValidator.getSessionBySubmissionValidation,
  ProctoringController.getSessionBySubmission
);

export default router;
