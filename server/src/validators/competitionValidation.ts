import { body, param } from "express-validator";

export const competitionSlugParam = [
  param("slug")
    .exists()
    .withMessage("slug is required")
    .bail()
    .isString()
    .trim()
    .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .withMessage("slug must be lowercase letters, numbers, and hyphens"),
];

export const competitionJoinValidation = [
  ...competitionSlugParam,
  body("candidateName")
    .exists()
    .withMessage("candidateName is required")
    .bail()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("candidateName cannot be empty")
    .isLength({ max: 200 })
    .withMessage("candidateName is too long"),
  body("candidateEmail")
    .exists()
    .withMessage("candidateEmail is required")
    .bail()
    .isEmail()
    .withMessage("candidateEmail must be a valid email")
    .bail()
    .normalizeEmail(),
];
