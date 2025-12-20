import express from "express";

import * as SubmissionController from "../controllers/submission.js";
import { verifyAuthToken } from "../validators/auth.js";
import * as SubmissionValidator from "../validators/submissionValidation.js";

const router = express.Router();

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

// Public endpoint - Get submission by token (for candidate access via URL)
// Must come before /:id route
router.get("/token/:token", SubmissionController.getSubmissionByToken);

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

// Public endpoint - Start a new submission
// Must come before /:id route
router.post(
  "/start",
  SubmissionValidator.startSubmissionValidation,
  SubmissionController.startSubmission
);

// Public endpoint - Final submission by token
// Must come before /:id route
router.post(
  "/token/:token/submit",
  SubmissionValidator.submitSubmissionValidation,
  SubmissionController.submitSubmissionByToken
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
