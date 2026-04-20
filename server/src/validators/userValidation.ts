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

/** PATCH /api/users/hackathon-default-slug — slug string or null to clear */
export const setHackathonDefaultSlugValidation = [
  body("slug")
    .exists()
    .withMessage("slug is required (use null to clear the default)")
    .custom((value) => {
      if (value === null || value === "") return true;
      if (typeof value !== "string") return false;
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim().toLowerCase());
    })
    .withMessage("slug must be lowercase letters, numbers, and hyphens only"),
];
