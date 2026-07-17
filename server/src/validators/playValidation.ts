import { body, param, query } from "express-validator";

const slugPattern = /^[a-z0-9-]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const listChallengesValidation = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("limit must be between 1 and 500"),
  query("from")
    .optional()
    .matches(datePattern)
    .withMessage("from must be YYYY-MM-DD"),
  query("to")
    .optional()
    .matches(datePattern)
    .withMessage("to must be YYYY-MM-DD"),
  query("status")
    .optional()
    .isIn(["draft", "published"])
    .withMessage("status must be draft or published"),
];

export const slugParamValidation = [
  param("slug")
    .trim()
    .matches(slugPattern)
    .withMessage("slug must be lowercase letters, numbers, and hyphens"),
];

export const createChallengeValidation = [
  body("slug")
    .trim()
    .notEmpty()
    .matches(slugPattern)
    .withMessage("slug must be lowercase letters, numbers, and hyphens"),
  body("challengeDate")
    .trim()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  body("title").trim().notEmpty().isLength({ max: 120 }),
  body("prompt").trim().notEmpty(),
  body("tokenBudget").isInt({ min: 1 }),
  body("timeLimitMinutes").optional().isInt({ min: 1 }),
  body("category")
    .trim()
    .isIn(["widget", "game", "tool", "other"])
    .withMessage("category must be widget, game, tool, or other"),
  body("status")
    .optional()
    .isIn(["draft", "published"])
    .withMessage("status must be draft or published"),
];

export const updateChallengeValidation = [
  ...slugParamValidation,
  body("slug")
    .optional()
    .trim()
    .matches(slugPattern)
    .withMessage("slug must be lowercase letters, numbers, and hyphens"),
  body("challengeDate")
    .optional()
    .trim()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  body("title").optional().trim().notEmpty().isLength({ max: 120 }),
  body("prompt").optional().trim().notEmpty(),
  body("tokenBudget").optional().isInt({ min: 1 }),
  body("timeLimitMinutes").optional().isInt({ min: 1 }),
  body("category")
    .optional()
    .trim()
    .isIn(["widget", "game", "tool", "other"]),
  body("status")
    .optional()
    .isIn(["draft", "published"]),
];

export const createSessionValidation = [
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
];

export const getSessionValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
];

export const pauseResumeSessionValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
];

export const postClaudeMessageValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  body("prompt")
    .optional()
    .trim()
    .isLength({ min: 1, max: 20000 }),
  body("message")
    .optional()
    .trim()
    .isLength({ min: 1, max: 20000 }),
  body("model").optional().trim().isLength({ min: 1, max: 120 }),
  body("effort").optional().trim().isLength({ min: 1, max: 32 }),
];

export const listSessionFilesValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
];

export const readSessionFileValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  query("path")
    .optional()
    .trim()
    .isLength({ min: 1, max: 512 }),
];

export const writeSessionFileValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  body("path")
    .optional()
    .trim()
    .isLength({ min: 1, max: 512 }),
  body("content").isString().withMessage("content must be a string"),
];

const terminalIdBody = body("terminalId")
  .optional()
  .trim()
  .isLength({ min: 1, max: 32 })
  .matches(/^(shell|preview|shell-\d+)$/i)
  .withMessage("invalid terminalId");

const terminalIdQuery = query("terminalId")
  .optional()
  .trim()
  .isLength({ min: 1, max: 32 })
  .matches(/^(shell|preview|shell-\d+)$/i)
  .withMessage("invalid terminalId");

export const openTerminalValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  terminalIdBody,
  body("cols").optional().isInt({ min: 20, max: 300 }),
  body("rows").optional().isInt({ min: 5, max: 120 }),
];

export const listTerminalsValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
];

export const terminalStreamValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  terminalIdQuery,
  query("pid").optional().isInt({ min: 1 }),
];

export const terminalInputValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  terminalIdBody,
  body("pid").isInt({ min: 1 }).withMessage("pid is required"),
  body("data").isString().withMessage("data must be a string"),
  body("encoding").optional().isIn(["utf8", "base64"]),
];

export const terminalResizeValidation = [
  param("id").trim().notEmpty().isMongoId().withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  terminalIdBody,
  body("pid").isInt({ min: 1 }).withMessage("pid is required"),
  body("cols").isInt({ min: 20, max: 300 }),
  body("rows").isInt({ min: 5, max: 120 }),
];

export const submitSessionValidation = [
  body("sessionId")
    .trim()
    .notEmpty()
    .isMongoId()
    .withMessage("invalid session id"),
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  body("displayName")
    .trim()
    .notEmpty()
    .isLength({ min: 1, max: 40 })
    .withMessage("displayName must be 1–40 characters"),
];

export const listSubmissionsValidation = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit must be between 1 and 200"),
  query("challengeDate")
    .optional()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
];

export const submissionIdParamValidation = [
  param("id")
    .trim()
    .notEmpty()
    .isMongoId()
    .withMessage("invalid submission id"),
];

export const publicListSubmissionsValidation = [
  query("challengeDate")
    .optional()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit must be between 1 and 200"),
  query("anonymousId")
    .optional()
    .trim()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId must be 8–128 characters"),
];

export const publicGetSubmissionValidation = [
  ...submissionIdParamValidation,
  query("anonymousId")
    .optional()
    .trim()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId must be 8–128 characters"),
];

export const voteNextValidation = [
  query("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  query("challengeDate")
    .optional()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  query("preferId")
    .optional()
    .isMongoId()
    .withMessage("preferId must be a valid submission id"),
];

export const castVoteValidation = [
  body("anonymousId")
    .trim()
    .notEmpty()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId is required"),
  body("challengeDate")
    .optional()
    .trim()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  body("winnerId")
    .trim()
    .notEmpty()
    .isMongoId()
    .withMessage("winnerId must be a valid submission id"),
  body("loserId")
    .trim()
    .notEmpty()
    .isMongoId()
    .withMessage("loserId must be a valid submission id"),
];

export const leaderboardValidation = [
  query("challengeDate")
    .optional()
    .matches(datePattern)
    .withMessage("challengeDate must be YYYY-MM-DD"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  query("anonymousId")
    .optional()
    .trim()
    .isLength({ min: 8, max: 128 })
    .withMessage("anonymousId must be 8–128 characters"),
];
