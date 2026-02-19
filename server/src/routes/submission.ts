import express from "express";

import * as SubmissionController from "../controllers/submission.js";
import * as TaskRunnerController from "../controllers/taskRunner.js";
import { verifyAuthToken } from "../validators/auth.js";
import {
  verifySubmissionAccess,
  verifySubmissionToken,
} from "../validators/submissionAuth.js";
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

// Employer endpoint - Delete a submission (auth required)
// Must come before /:id route
router.delete(
  "/:submissionId",
  [verifyAuthToken],
  SubmissionController.deleteSubmission
);

// Employer endpoint - Generate interview questions for a submission (auth required)
// Must come before /:id route
router.post(
  "/:submissionId/generate-interview",
  [verifyAuthToken],
  SubmissionController.generateInterviewQuestions
);

// Get interview agent prompt for a submission
// Accessible by: employer (auth) or candidate (token)
// Must come before /:id route
router.get(
  "/:submissionId/interview-agent-prompt",
  verifySubmissionAccess,
  SubmissionController.getInterviewAgentPrompt
);

// Update interview conversationId (called when interview starts)
// Accessible by: employer (auth) or candidate (token)
// Must come before /:id route
router.patch(
  "/:submissionId/interview-conversation-id",
  verifySubmissionAccess,
  SubmissionController.updateInterviewConversationId
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

// Public endpoint - Generate interview questions by token (for candidates)
router.post(
  "/token/:token/generate-interview",
  SubmissionController.generateInterviewQuestionsByToken
);

// Public endpoint - Opt out of assessment by token
router.post("/token/:token/opt-out", SubmissionController.optOutByToken);

// Public endpoint - Upload LLM trace (controller runs multer internally; do not add uploadLLMTrace here or body is consumed twice)
router.post(
  "/token/:token/upload-trace",
  SubmissionController.uploadLLMTraceByToken
);

// Employer endpoint - Execute tasks
router.post(
  "/:submissionId/execute-tasks",
  [verifyAuthToken],
  TaskRunnerController.executeAllTasksForSubmission
);

// Employer endpoint - Calculate workflow scores
router.post(
  "/:submissionId/calculate-workflow-scores",
  [verifyAuthToken],
  SubmissionController.calculateWorkflowScoresHandler
);

// Employer endpoint - Calculate full scores (completeness + workflow)
router.post(
  "/:submissionId/calculate-scores",
  [verifyAuthToken],
  SubmissionController.calculateScoresHandler
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
