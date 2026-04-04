import { body } from "express-validator";

export const evaluateValidation = [
  body("submissionId")
    .optional()
    .isString()
    .withMessage("submissionId must be a string")
    .notEmpty()
    .withMessage("submissionId cannot be empty"),
  body("transcript")
    .optional()
    .isArray()
    .withMessage("transcript must be an array"),
  body("criteria")
    .optional()
    .isArray()
    .withMessage("criteria must be an array"),
].concat([
  body().custom((_value, { req }) => {
    const hasSubmissionId = req.body?.submissionId;
    const hasTranscriptAndCriteria =
      Array.isArray(req.body?.transcript) && Array.isArray(req.body?.criteria);
    if (!hasSubmissionId && !hasTranscriptAndCriteria) {
      throw new Error(
        "Either submissionId or both transcript and criteria are required"
      );
    }
    if (hasSubmissionId && hasTranscriptAndCriteria) {
      throw new Error(
        "Provide either submissionId or transcript+criteria, not both"
      );
    }
    return true;
  }),
]);

export const validateCriterionValidation = [
  body("criterion")
    .exists()
    .withMessage("criterion is required")
    .bail()
    .isString()
    .withMessage("criterion must be a string")
    .bail()
    .notEmpty()
    .withMessage("criterion cannot be empty"),
];

export const suggestCriteriaValidation = [
  body("job_description")
    .exists()
    .withMessage("job_description is required")
    .bail()
    .isString()
    .withMessage("job_description must be a string")
    .bail()
    .notEmpty()
    .withMessage("job_description cannot be empty"),
];
