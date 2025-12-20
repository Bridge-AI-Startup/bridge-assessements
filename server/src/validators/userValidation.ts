import { body } from "express-validator";

/**
 * Validators for user operations
 */
const makeCompanyNameValidator = () =>
  body("companyName")
    .exists()
    .withMessage("companyName is required")
    .bail()
    .isString()
    .withMessage("companyName must be a string")
    .bail()
    .notEmpty()
    .withMessage("companyName cannot be empty");

const makeEmailValidator = () =>
  body("email")
    .exists()
    .withMessage("email is required")
    .bail()
    .isEmail()
    .withMessage("email must be a valid email address")
    .bail()
    .notEmpty()
    .withMessage("email cannot be empty");

const makePasswordValidator = () =>
  body("password")
    .exists()
    .withMessage("password is required")
    .bail()
    .isString()
    .withMessage("password must be a string");

export const createUserValidation = [
  makeCompanyNameValidator(),
  // email and password are not needed - Firebase user is already created by frontend
  // uid is added by verifyAuthToken middleware
];
