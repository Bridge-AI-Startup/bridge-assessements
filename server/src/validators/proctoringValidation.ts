import { body, param } from "express-validator";

/**
 * Validators for proctoring operations
 */

export const createSessionValidation = [
  body("submissionId")
    .exists()
    .withMessage("submissionId is required")
    .bail()
    .isMongoId()
    .withMessage("submissionId must be a valid MongoDB ObjectId"),
  body("token")
    .exists()
    .withMessage("token is required")
    .bail()
    .isString()
    .withMessage("token must be a string")
    .bail()
    .notEmpty()
    .withMessage("token cannot be empty"),
];

export const grantConsentValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
  body("screens")
    .exists()
    .withMessage("screens is required")
    .bail()
    .isInt({ min: 1, max: 6 })
    .withMessage("screens must be between 1 and 6"),
  body("token")
    .exists()
    .withMessage("token is required")
    .bail()
    .isString()
    .withMessage("token must be a string"),
];

export const uploadFrameValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
];

export const uploadBatchValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
];

export const sidecarEventValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
  body("events")
    .exists()
    .withMessage("events is required")
    .bail()
    .isArray({ min: 1, max: 50 })
    .withMessage("events must be an array of 1-50 items"),
  body("events.*.type")
    .exists()
    .withMessage("event type is required")
    .bail()
    .isIn([
      "tab_switch",
      "window_blur",
      "window_focus",
      "clipboard_copy",
      "clipboard_paste",
      "url_change",
      "idle_start",
      "idle_end",
      "stream_lost",
      "stream_restored",
    ])
    .withMessage("Invalid event type"),
  body("events.*.timestamp")
    .exists()
    .withMessage("event timestamp is required")
    .bail()
    .isISO8601()
    .withMessage("event timestamp must be a valid ISO 8601 date"),
  body("token")
    .exists()
    .withMessage("token is required")
    .bail()
    .isString()
    .withMessage("token must be a string"),
];

export const completeSessionValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
  body("token")
    .exists()
    .withMessage("token is required")
    .bail()
    .isString()
    .withMessage("token must be a string"),
];

export const generateTranscriptValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
];

export const getSessionBySubmissionValidation = [
  param("submissionId")
    .isMongoId()
    .withMessage("submissionId must be a valid MongoDB ObjectId"),
];
