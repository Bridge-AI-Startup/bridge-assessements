import { body } from "express-validator";

/**
 * Validators for assessment operations
 */
const makeTitleValidator = () =>
  body("title")
    .exists()
    .withMessage("title is required")
    .bail()
    .isString()
    .withMessage("title must be a string")
    .bail()
    .notEmpty()
    .withMessage("title cannot be empty")
    .bail()
    .isLength({ max: 200 })
    .withMessage("title must be at most 200 characters");

const makeDescriptionValidator = () =>
  body("description")
    .exists()
    .withMessage("description is required")
    .bail()
    .isString()
    .withMessage("description must be a string")
    .bail()
    .notEmpty()
    .withMessage("description cannot be empty");

const makeTimeLimitValidator = () =>
  body("timeLimit")
    .exists()
    .withMessage("timeLimit is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("timeLimit must be a positive integer (in minutes)")
    .bail()
    .toInt();

// Optional validators for updates
const makeOptionalTitleValidator = () =>
  body("title")
    .optional()
    .isString()
    .withMessage("title must be a string")
    .bail()
    .notEmpty()
    .withMessage("title cannot be empty")
    .bail()
    .isLength({ max: 200 })
    .withMessage("title must be at most 200 characters");

const makeOptionalDescriptionValidator = () =>
  body("description")
    .optional()
    .isString()
    .withMessage("description must be a string")
    .bail()
    .notEmpty()
    .withMessage("description cannot be empty");

const makeOptionalTimeLimitValidator = () =>
  body("timeLimit")
    .optional()
    .isInt({ min: 1 })
    .withMessage("timeLimit must be a positive integer (in minutes)")
    .bail()
    .toInt();

const makeOptionalEvaluationCriteriaValidator = () =>
  body("evaluationCriteria")
    .optional()
    .isArray()
    .withMessage("evaluationCriteria must be an array")
    .bail()
    .custom((arr) =>
      (arr || []).every((c) => typeof c === "string" && c.trim().length > 0)
    )
    .withMessage(
      "evaluationCriteria must be an array of non-empty strings"
    );

const BEHAVIORAL_CHECKS_MAX = 18;
const BEHAVIORAL_CHECK_MAX_LEN = 400;

const makeOptionalBehavioralChecksValidator = () =>
  body("behavioralChecks")
    .optional()
    .isArray()
    .withMessage("behavioralChecks must be an array")
    .bail()
    .custom((arr: unknown) => {
      if (!Array.isArray(arr)) return false;
      if (arr.length > BEHAVIORAL_CHECKS_MAX) return false;
      return arr.every(
        (c) =>
          typeof c === "string" &&
          c.trim().length > 0 &&
          c.length <= BEHAVIORAL_CHECK_MAX_LEN
      );
    })
    .withMessage(
      `behavioralChecks must be at most ${BEHAVIORAL_CHECKS_MAX} non-empty strings, each at most ${BEHAVIORAL_CHECK_MAX_LEN} characters`
    );
const makeOptionalStarterCodeFilesValidator = () =>
  body("starterCodeFiles")
    .optional()
    .isArray()
    .withMessage("starterCodeFiles must be an array");

/**
 * Shape is validated by Zod in `behavioralGrading/checkSpecs.ts` — the acceptance
 * schemas are far too structured for express-validator, and grading resolves
 * through the parser anyway. This only rejects obvious junk early, with a message
 * naming the offending entry so a bad edit is not silently dropped later.
 */
const makeOptionalBehavioralCheckSpecsValidator = () =>
  body("behavioralCheckSpecs")
    .optional({ nullable: true })
    .isArray()
    .withMessage("behavioralCheckSpecs must be an array")
    .bail()
    .custom(async (arr: unknown) => {
      const { parseBehavioralCheckSpecs } = await import(
        "../services/behavioralGrading/checkSpecs.js"
      );
      const { rejected } = parseBehavioralCheckSpecs(arr);
      if (rejected.length > 0) {
        throw new Error(
          `invalid check spec at index ${rejected[0].index} — ${rejected[0].reason}`
        );
      }
      return true;
    });

export const createAssessmentValidation = [
  makeTitleValidator(),
  makeDescriptionValidator(),
  makeTimeLimitValidator(),
  makeOptionalBehavioralChecksValidator(),
  makeOptionalBehavioralCheckSpecsValidator(),
  makeOptionalEvaluationCriteriaValidator(),
  makeOptionalStarterCodeFilesValidator(),
];

export const updateAssessmentValidation = [
  makeOptionalTitleValidator(),
  makeOptionalDescriptionValidator(),
  makeOptionalTimeLimitValidator(),
  makeOptionalBehavioralChecksValidator(),
  makeOptionalBehavioralCheckSpecsValidator(),
  makeOptionalEvaluationCriteriaValidator(),
  makeOptionalStarterCodeFilesValidator(),
];

const makeOptionalStackValidator = () =>
  body("stack")
    .optional()
    .isIn([
      "frontend-react",
      "frontend-vue",
      "backend-node",
      "backend-python",
      "mobile-react-native",
      "fullstack",
      "generic",
    ])
    .withMessage("stack must be one of: frontend-react, frontend-vue, backend-node, backend-python, mobile-react-native, fullstack, generic");

const makeOptionalLevelValidator = () =>
  body("level")
    .optional()
    .isIn(["junior", "mid", "senior"])
    .withMessage("level must be one of: junior, mid, senior");

export const generateAssessmentValidation = [
  makeDescriptionValidator(),
  makeOptionalStackValidator(),
  makeOptionalLevelValidator(),
];

export const generateBehavioralChecksValidation = [
  makeTitleValidator(),
  makeDescriptionValidator(),
];
