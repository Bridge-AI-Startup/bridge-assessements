import express from "express";
import multer from "multer";
import os from "os";

import * as ProctoringController from "../controllers/proctoring.js";
import * as ProctoringValidator from "../validators/proctoringValidation.js";
import { verifyAuthToken, optionalAuthToken } from "../validators/auth.js";

const router = express.Router();

const frameUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
}).single("frame");

// Video chunks go to disk, not RAM: a 50MB chunk per in-flight request on the heap
// is what OOMs the server under concurrent candidates. The controller unlinks the
// temp file when done.
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).single("chunk");

// Dev-only test endpoints (must be before :sessionId param routes)
router.post(
  "/sessions/test/create",
  ProctoringController.createTestSession
);
router.get(
  "/sessions/test/list-storage-sessions",
  ProctoringController.listStorageSessions
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

router.get(
  "/sessions/by-candidate-token",
  ProctoringValidator.getSessionByCandidateTokenValidation,
  ProctoringController.getSessionByCandidateToken
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

// Companion (in-session ElevenLabs voice check-in) — candidate token or employer auth

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
router.post(
  "/sessions/:sessionId/companion/complete",
  ProctoringValidator.companionCompleteValidation,
  ProctoringController.completeCompanion
);
router.get(
  "/sessions/:sessionId/companion/transcript",
  optionalAuthToken,
  ProctoringValidator.getCompanionTranscriptValidation,
  ProctoringController.getCompanionTranscript
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
  "/sessions/:sessionId/playback-video",
  verifyAuthToken,
  ...ProctoringValidator.getPlaybackVideoValidation,
  ProctoringController.getPlaybackVideo
);

router.get(
  "/sessions/:sessionId/download-video",
  ProctoringController.downloadSessionVideo
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
