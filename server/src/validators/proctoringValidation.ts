import { body, param } from "express-validator";

/**
 * Validators for proctoring operations
 */

export const createSessionValidation = [
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
    .custom((val) => {
      const date =
        typeof val === "number" ? new Date(val) : new Date(val as string);
      if (Number.isNaN(date.getTime()))
        throw new Error("event timestamp must be a valid date or Unix ms");
      return true;
    }),
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

export const getPlaybackVideoValidation = [
  param("sessionId")
    .isMongoId()
    .withMessage("sessionId must be a valid MongoDB ObjectId"),
];

export const getSessionBySubmissionValidation = [
  param("submissionId")
    .isMongoId()
    .withMessage("submissionId must be a valid MongoDB ObjectId"),
];

/** Render overlay PNG from regions (no detection). */
export const renderOverlayValidation = [
  body("regions")
    .isArray({ min: 1, max: 20 })
    .withMessage("regions must be an array of 1–20 items"),
  body("regions.*.regionType")
    .isString()
    .withMessage("regionType must be a string"),
  body("regions.*.x")
    .isFloat({ min: 0, max: 100 })
    .withMessage("x must be 0–100"),
  body("regions.*.y")
    .isFloat({ min: 0, max: 100 })
    .withMessage("y must be 0–100"),
  body("regions.*.width")
    .isFloat({ min: 0, max: 100 })
    .withMessage("width must be 0–100"),
  body("regions.*.height")
    .isFloat({ min: 0, max: 100 })
    .withMessage("height must be 0–100"),
  body("width")
    .isInt({ min: 1, max: 4096 })
    .withMessage("width must be 1–4096"),
  body("height")
    .isInt({ min: 1, max: 4096 })
    .withMessage("height must be 1–4096"),
];

/** Interpret raw JSONL transcript (paste-in test page). */
export const interpretRawTranscriptValidation = [
  body("rawJsonl")
    .exists()
    .withMessage("rawJsonl is required")
    .bail()
    .isString()
    .withMessage("rawJsonl must be a string")
    .bail()
    .notEmpty()
    .withMessage("rawJsonl cannot be empty")
    .bail()
    .isLength({ max: 2 * 1024 * 1024 })
    .withMessage("rawJsonl must be at most 2MB"),
];
