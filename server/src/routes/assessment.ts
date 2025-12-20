import express from "express";

import * as AssessmentController from "../controllers/assessment.js";
import { verifyAuthToken } from "../validators/auth.js";
import * as AssessmentValidator from "../validators/assessmentValidation.js";

const router = express.Router();

// Generate assessment data from description (AI endpoint)
router.post(
  "/generate",
  [verifyAuthToken],
  AssessmentValidator.generateAssessmentValidation,
  AssessmentController.generateAssessmentData
);

// Create a new assessment
router.post(
  "/",
  [verifyAuthToken],
  AssessmentValidator.createAssessmentValidation,
  AssessmentController.createAssessment
);

// Get all assessments for the current user
router.get("/", [verifyAuthToken], AssessmentController.getAssessments);

// Get a single assessment by ID
router.get("/:id", [verifyAuthToken], AssessmentController.getAssessment);

// Update an assessment
router.patch(
  "/:id",
  [verifyAuthToken],
  AssessmentValidator.updateAssessmentValidation,
  AssessmentController.updateAssessment
);

// Delete an assessment
router.delete("/:id", [verifyAuthToken], AssessmentController.deleteAssessment);

// Chat endpoint for interacting with assessment
router.post(
  "/:id/chat",
  [verifyAuthToken],
  AssessmentController.chatWithAssessment
);

export default router;
