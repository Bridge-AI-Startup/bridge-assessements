import express from "express";
import { auth } from "../config/firebaseAdmin.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import User from "../models/User.js";

const router = express.Router();

// POST /api/auth/verify - Verify token and get user info
router.post("/verify", verifyToken, async (req, res) => {
  try {
    // User is already verified by middleware
    res.status(200).json({
      success: true,
      data: {
        uid: req.user.uid,
        email: req.user.email,
        emailVerified: req.user.emailVerified,
        name: req.user.name,
      },
    });
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// POST /api/auth/user - Create or update user in database
router.post("/user", verifyToken, async (req, res, next) => {
  try {
    const { name, logo } = req.body;
    const { uid, email } = req.user;

    // Check if user exists in database
    let user = await User.findByEmail(email);

    if (user) {
      // Update existing user
      const updates = {};
      if (name) updates.name = name;
      if (logo !== undefined) updates.logo = logo;

      if (Object.keys(updates).length > 0) {
        user = await User.updateById(user._id.toString(), updates);
      }

      res.status(200).json({
        success: true,
        data: user,
      });
    } else {
      // Create new user
      const newUser = await User.create({
        email,
        name: name || email.split("@")[0],
        logo: logo || null,
      });

      res.status(201).json({
        success: true,
        data: newUser,
      });
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/user - Get current user from database
router.get("/user", verifyToken, async (req, res, next) => {
  try {
    const { email } = req.user;

    const user = await User.findByEmail(email);

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

export default router;
