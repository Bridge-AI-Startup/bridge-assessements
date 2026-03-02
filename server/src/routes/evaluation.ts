import express from "express";

import * as EvaluationController from "../controllers/evaluation.js";
import { verifyAuthToken } from "../validators/auth.js";
import * as EvaluationValidator from "../validators/evaluationValidation.js";

const router = express.Router();

router.post(
  "/evaluate",
  [verifyAuthToken],
  EvaluationValidator.evaluateValidation,
  EvaluationController.evaluate
);

router.post(
  "/validate-criterion",
  [verifyAuthToken],
  EvaluationValidator.validateCriterionValidation,
  EvaluationController.validateCriterionHandler
);

router.post(
  "/suggest-criteria",
  [verifyAuthToken],
  EvaluationValidator.suggestCriteriaValidation,
  EvaluationController.suggestCriteriaHandler
);

export default router;
