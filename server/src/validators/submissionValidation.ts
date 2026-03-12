import { body } from "express-validator";

/**
 * Validators for submission operations
 */

const makeCandidateNameValidator = () =>
  body("candidateName")
    .optional()
    .isString()
    .withMessage("candidateName must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("candidateName cannot be empty");

const makeCandidateEmailValidator = () =>
  body("candidateEmail")
    .optional()
    .isEmail()
    .withMessage("candidateEmail must be a valid email address")
    .bail()
    .normalizeEmail();

const makeGithubLinkValidator = () =>
  body("githubLink")
    .optional()
    .isString()
    .withMessage("githubLink must be a string")
    .bail()
    .trim()
    .custom((value) => {
      if (!value) return true; // Allow empty for in-progress submissions
      // Validate GitHub URL format
      const githubUrlPattern =
        /^https?:\/\/(www\.)?github\.com\/[\w\-\.]+\/[\w\-\.]+/;
      if (!githubUrlPattern.test(value)) {
        throw new Error("Please provide a valid GitHub repository URL");
      }
      return true;
    });

const makeTimeSpentValidator = () =>
  body("timeSpent")
    .optional()
    .isInt({ min: 0 })
    .withMessage("timeSpent must be a non-negative integer (in minutes)")
    .bail()
    .toInt();

// Validators for starting a submission
export const startSubmissionValidation = [
  body("assessmentId")
    .exists()
    .withMessage("assessmentId is required")
    .bail()
    .isMongoId()
    .withMessage("assessmentId must be a valid MongoDB ObjectId"),
  makeCandidateNameValidator(),
  makeCandidateEmailValidator(),
];

// Validators for updating a submission (auto-save)
export const updateSubmissionValidation = [
  makeGithubLinkValidator(),
  makeTimeSpentValidator(),
];

// Validators for final submission
export const submitSubmissionValidation = [
  body("githubLink")
    .exists()
    .withMessage("githubLink is required")
    .bail()
    .isString()
    .withMessage("githubLink must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("githubLink cannot be empty")
    .bail()
    .custom((value) => {
      // Validate GitHub URL format
      const githubUrlPattern =
        /^https?:\/\/(www\.)?github\.com\/[\w\-\.]+\/[\w\-\.]+/;
      if (!githubUrlPattern.test(value)) {
        throw new Error("Please provide a valid GitHub repository URL");
      }
      return true;
    }),
  // timeSpent is now calculated server-side, so we don't need it in the request
];

// Validators for generating a share link (employer endpoint)
export const generateShareLinkValidation = [
  body("assessmentId")
    .exists()
    .withMessage("assessmentId is required")
    .bail()
    .isMongoId()
    .withMessage("assessmentId must be a valid MongoDB ObjectId"),
  body("candidateName")
    .exists()
    .withMessage("candidateName is required")
    .bail()
    .isString()
    .withMessage("candidateName must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("candidateName cannot be empty"),
  makeCandidateEmailValidator(),
];

// Validators for bulk generating share links (employer endpoint)
export const bulkGenerateLinksValidation = [
  body("assessmentId")
    .exists()
    .withMessage("assessmentId is required")
    .bail()
    .isMongoId()
    .withMessage("assessmentId must be a valid MongoDB ObjectId"),
  body("candidates")
    .exists()
    .withMessage("candidates is required")
    .bail()
    .isArray({ min: 1 })
    .withMessage("candidates must be a non-empty array")
    .bail()
    .custom((value: unknown[]) => {
      if (value.length > 100) {
        throw new Error("candidates must contain at most 100 entries");
      }
      return true;
    }),
  body("candidates.*.name")
    .exists()
    .withMessage("each candidate must have a name")
    .bail()
    .isString()
    .withMessage("candidate name must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("candidate name cannot be empty"),
  body("candidates.*.email")
    .exists()
    .withMessage("each candidate must have an email")
    .bail()
    .isEmail()
    .withMessage("candidate email must be a valid email address")
    .bail()
    .normalizeEmail(),
];

// Validators for sending invite emails (employer endpoint)
export const sendInvitesValidation = [
  body("submissionIds")
    .exists()
    .withMessage("submissionIds is required")
    .bail()
    .isArray({ min: 1 })
    .withMessage("submissionIds must be a non-empty array")
    .bail()
    .custom((value: unknown[]) => {
      if (value.length > 100) {
        throw new Error("submissionIds must contain at most 100 entries");
      }
      return true;
    }),
  body("submissionIds.*")
    .isMongoId()
    .withMessage("each submissionId must be a valid MongoDB ObjectId"),
];
