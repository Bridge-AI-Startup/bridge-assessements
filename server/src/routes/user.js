import express from "express";
import { ObjectId } from "mongodb";
import User from "../models/User.js";

const router = express.Router();

// GET /api/users - Get all users
router.get("/", async (req, res, next) => {
  try {
    const { limit = 100, skip = 0 } = req.query;
    const users = await User.findAll({
      limit: parseInt(limit),
      skip: parseInt(skip),
    });
    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id - Get a single user by id
router.get("/:id", async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

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
  } catch (err) {
    next(err);
  }
});

// GET /api/users/email/:email - Get user by email
router.get("/email/:email", async (req, res, next) => {
  try {
    const user = await User.findByEmail(req.params.email);

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
  } catch (err) {
    next(err);
  }
});

// POST /api/users - Create a new user
router.post("/", async (req, res, next) => {
  try {
    const { email, name, logo } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: "Email and name are required",
      });
    }

    const user = await User.create({ email, name, logo });

    res.status(201).json({
      success: true,
      data: user,
    });
  } catch (err) {
    // Handle duplicate email error
    if (err.message.includes("already exists")) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
});

// PATCH /api/users/:id - Update a user (partial)
router.patch("/:id", async (req, res, next) => {
  try {
    const user = await User.updateById(req.params.id, req.body);

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
  } catch (err) {
    // Handle duplicate email error
    if (err.message.includes("already in use")) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
});

// PUT /api/users/:id - Replace a user (full update)
router.put("/:id", async (req, res, next) => {
  try {
    const { email, name, logo } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: "Email and name are required",
      });
    }

    const user = await User.updateById(req.params.id, { email, name, logo });

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
  } catch (err) {
    // Handle duplicate email error
    if (err.message.includes("already in use")) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
});

// DELETE /api/users/:id - Delete a user
router.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await User.deleteById(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

export default router;

