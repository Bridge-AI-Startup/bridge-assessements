import express from "express";
import multer from "multer";

import { DEFAULT_SUBMISSION_UPLOAD_MAX_BYTES } from "../config/uploadLimits.js";
import * as SubmissionController from "../controllers/submission.js";
import * as RuntimeSetupController from "../controllers/runtimeSetup.js";
import { verifyAuthToken } from "../validators/auth.js";
import * as SubmissionValidator from "../validators/submissionValidation.js";

const router = express.Router();
const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(
      process.env.SUBMISSION_UPLOAD_MAX_BYTES || DEFAULT_SUBMISSION_UPLOAD_MAX_BYTES
    ),
  },
}).single("archive");

// Public endpoint - Get assessment details (for candidate to view before starting)
// Must come before /:id route
router.get("/assessments/public/:id", SubmissionController.getPublicAssessment);

// Employer endpoint - Generate share link for a candidate (auth required)
// Must come before /:id route
router.post(
  "/generate-link",
  [verifyAuthToken],
  SubmissionValidator.generateShareLinkValidation,
  SubmissionController.generateShareLink
);

// Employer endpoint - Bulk generate share links for multiple candidates (auth required)
// Must come before /:id route
router.post(
  "/bulk-generate-links",
  [verifyAuthToken],
  SubmissionValidator.bulkGenerateLinksValidation,
  SubmissionController.bulkGenerateLinks
);

// Employer endpoint - Send invite emails to candidates (auth required)
// Must come before /:id route
router.post(
  "/send-invites",
  [verifyAuthToken],
  SubmissionValidator.sendInvitesValidation,
  SubmissionController.sendInvites
);

// Public endpoint - Get submission by token (for candidate access via URL)
// Must come before /:id route
router.get("/token/:token", SubmissionController.getSubmissionByToken);

// Candidate runtime setup (token-based). Feature-gated in the service layer.
router.put(
  "/token/:token/runtime/config",
  RuntimeSetupController.putConfig
);
router.post(
  "/token/:token/runtime/session",
  RuntimeSetupController.postSession
);
router.post(
  "/token/:token/runtime/restart",
  RuntimeSetupController.postRestart
);
router.post("/token/:token/runtime/run", RuntimeSetupController.postRun);
router.get("/token/:token/runtime/status", RuntimeSetupController.getStatus);
router.get("/token/:token/runtime/logs", RuntimeSetupController.getLogLines);
router.post("/token/:token/runtime/pause", RuntimeSetupController.postPause);
router.post("/token/:token/runtime/resume", RuntimeSetupController.postResume);
router.post(
  "/token/:token/runtime/finalize",
  RuntimeSetupController.postFinalize
);

// Public endpoint - Start assessment (update status to "in-progress")
// Must come before /:id route
router.post("/token/:token/start", SubmissionController.startAssessment);

// Employer endpoint - Get all submissions for an assessment (auth required)
// Must come before /:id route
router.get(
  "/assessments/:id/submissions",
  [verifyAuthToken],
  SubmissionController.getSubmissionsForAssessment
);

router.get(
  "/assessments/:assessmentId/evidence-export",
  [verifyAuthToken],
  SubmissionController.exportAssessmentEvidenceZip
);

// Employer endpoint - Delete a submission (auth required)
// Must come before /:id route
router.delete(
  "/:submissionId",
  [verifyAuthToken],
  SubmissionController.deleteSubmission
);

// Employer endpoint - Index repository into Pinecone (auth required)
// Must come before /:id route
router.post(
  "/:submissionId/index-repo",
  [verifyAuthToken],
  SubmissionController.indexSubmissionRepository
);

// Employer endpoint - Get repository index status (auth required)
// Must come before /:id route
router.get(
  "/:submissionId/repo-index/status",
  [verifyAuthToken],
  SubmissionController.getRepoIndexStatus
);

// Search code chunks for a submission
// Accessible by: employer (auth) only - this is a debug/admin endpoint
// Must come before /:id route
router.post(
  "/:submissionId/search-code",
  verifyAuthToken,
  SubmissionController.searchCode
);

// Public endpoint - Final submission by token
// Must come before /:id route
router.post(
  "/token/:token/submit",
  SubmissionValidator.submitSubmissionValidation,
  SubmissionController.submitSubmissionByToken
);

// Public endpoint - Finalize timed-out attempt with screen recording only
router.post(
  "/token/:token/submit-recording-only",
  SubmissionController.submitRecordingOnlyByToken
);

// Public endpoint - Upload local archive and submit by token
router.post(
  "/token/:token/upload",
  archiveUpload,
  SubmissionController.uploadSubmissionByToken
);

// Public endpoint - Opt out of assessment by token
router.post("/token/:token/opt-out", SubmissionController.optOutByToken);

// Employer endpoint - Trigger behavioral grading (manual re-run)
router.post(
  "/:submissionId/grade-behavioral",
  [verifyAuthToken],
  SubmissionController.gradeBehavioralHandler
);

router.get(
  "/:submissionId/behavioral-artifact",
  [verifyAuthToken],
  SubmissionController.getBehavioralArtifactHandler
);

router.get(
  "/:submissionId/code-archive",
  [verifyAuthToken],
  SubmissionController.getSubmissionCodeArchiveHandler
);

router.post(
  "/:submissionId/runtime/preview",
  [verifyAuthToken],
  RuntimeSetupController.postReplay
);
router.get(
  "/:submissionId/runtime/preview/status",
  [verifyAuthToken],
  RuntimeSetupController.getReplayStatusHandler
);
router.get(
  "/:submissionId/runtime/preview/logs",
  [verifyAuthToken],
  RuntimeSetupController.getReplayLogLines
);
router.post(
  "/:submissionId/runtime/preview/stop",
  [verifyAuthToken],
  RuntimeSetupController.postReplayStop
);

// Public endpoint - Final submission
// Must come before /:id route
router.post(
  "/:id/submit",
  SubmissionValidator.submitSubmissionValidation,
  SubmissionController.submitSubmission
);

// Public endpoint - Update a submission (auto-save)
router.patch(
  "/:id",
  SubmissionValidator.updateSubmissionValidation,
  SubmissionController.updateSubmission
);

// Public endpoint - Get a submission by ID (for candidate to resume)
// Must be last to avoid conflicts
router.get("/:id", SubmissionController.getSubmission);

export default router;
