import { body } from "express-validator";

export const generateLinkRules = [
  body("assessmentId").trim().notEmpty().withMessage("Invalid assessmentId"),
  body("candidateName").trim().notEmpty().isLength({ max: 200 }),
  body("displayName").optional().trim().isLength({ max: 200 }),
  body("candidateEmail").isEmail().normalizeEmail(),
  /** Honeypot: leave empty; server should reject if set (challenge E2). */
  body("website").optional().isString(),
];
