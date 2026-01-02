import express from "express";

import * as UserController from "../controllers/user.js";
import { verifyAuthToken } from "../validators/auth.js";
import * as UserValidator from "../validators/userValidation.js";

const router = express.Router();

router.post(
  "/create",
  [verifyAuthToken],
  UserValidator.createUserValidation,
  UserController.createUser
);
router.get("/whoami", [verifyAuthToken], UserController.loginUser);
router.post("/delete", [verifyAuthToken], UserController.deleteAccount);

export default router;
