import { body } from "express-validator";

export const createAssessmentRules = [
  body("title").trim().notEmpty().isLength({ max: 200 }),
  body("description").optional().isString(),
  body("timeLimit").isInt({ min: 1, max: 24 * 14 }),
];
