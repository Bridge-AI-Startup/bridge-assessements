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

export const createAssessmentValidation = [
  makeTitleValidator(),
  makeDescriptionValidator(),
  makeTimeLimitValidator(),
];

export const updateAssessmentValidation = [
  makeOptionalTitleValidator(),
  makeOptionalDescriptionValidator(),
  makeOptionalTimeLimitValidator(),
];

export const generateAssessmentValidation = [makeDescriptionValidator()];
