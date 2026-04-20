import { Router } from "express";
import * as UserController from "../controllers/user.js";
import * as AssessmentController from "../controllers/assessment.js";
import * as SubmissionController from "../controllers/submission.js";
import { verifyEmployerToken } from "../middleware/auth.js";
import { createAssessmentRules } from "../validators/assessment.js";
import { generateLinkRules } from "../validators/submission.js";

const router = Router();

router.post("/users/bootstrap", UserController.bootstrapUser);

router.post(
  "/assessments",
  verifyEmployerToken,
  createAssessmentRules,
  AssessmentController.createAssessment,
);
router.get("/assessments/:id", verifyEmployerToken, AssessmentController.getAssessment);

router.post(
  "/submissions/generate-link",
  verifyEmployerToken,
  generateLinkRules,
  SubmissionController.generateLink,
);
router.get(
  "/submissions/assessments/:assessmentId/submissions",
  verifyEmployerToken,
  SubmissionController.listSubmissionsForAssessment,
);
router.get(
  "/submissions/assessments/public/:id",
  SubmissionController.getPublicAssessment,
);
router.get("/submissions/token/:token", SubmissionController.getSubmissionByToken);
router.post("/submissions/token/:token/start", SubmissionController.startAssessment);
router.post("/submissions/token/:token/submit", SubmissionController.submitAssessment);

export default router;
