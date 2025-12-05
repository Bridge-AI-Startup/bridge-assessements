import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
  createUser,
  loginUser,
  getUserByFirebaseUid,
  getUserByEmail,
  updateUserByFirebaseUid,
} from "../controllers/userController.js";

const router = express.Router();

/**
 * POST /api/user-auth/create
 * Create a new user in the database
 * Requires Firebase token in Authorization header
 */
router.post("/create", verifyToken, async (req, res, next) => {
  try {
    const { name, companyLogoUrl } = req.body;
    const { uid, email } = req.user;

    const user = await createUser({
      firebaseUid: uid,
      email,
      name: name || email.split("@")[0],
      companyLogoUrl: companyLogoUrl || null,
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: user,
    });
  } catch (error) {
    if (error.message.includes("already exists")) {
      return res.status(409).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
});

/**
 * POST /api/user-auth/login
 * Login/Create user - Verifies token and gets/creates user in database
 * This handles both login and signup scenarios
 */
router.post("/login", async (req, res, next) => {
  try {
    const { token, name, companyLogoUrl } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Firebase token is required",
      });
    }

    const user = await loginUser(token, {
      name,
      companyLogoUrl,
    });

    res.status(200).json({
      success: true,
      message: "User logged in successfully",
      data: user,
    });
  } catch (error) {
    if (error.message.includes("Token expired")) {
      return res.status(401).json({
        success: false,
        error: error.message,
      });
    }
    if (error.message.includes("Invalid token")) {
      return res.status(401).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
});

/**
 * GET /api/user-auth/me
 * Get current user by Firebase token
 * Requires Firebase token in Authorization header
 */
router.get("/me", verifyToken, async (req, res, next) => {
  try {
    const { uid } = req.user;

    const user = await getUserByFirebaseUid(uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found in database",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user-auth/email/:email
 * Get user by email
 * Requires Firebase token in Authorization header
 */
router.get("/email/:email", verifyToken, async (req, res, next) => {
  try {
    const user = await getUserByEmail(req.params.email);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/user-auth/me
 * Update current user
 * Requires Firebase token in Authorization header
 */
router.patch("/me", verifyToken, async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { name, email, companyLogoUrl } = req.body;

    const user = await updateUserByFirebaseUid(uid, {
      name,
      email,
      companyLogoUrl,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    if (error.message.includes("already in use")) {
      return res.status(409).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
});

export default router;

