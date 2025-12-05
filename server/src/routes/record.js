import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db/connection.js";

const router = express.Router();

// GET /api/records - Get all records
router.get("/", async (req, res, next) => {
  try {
    const db = getDB();
    const collection = db.collection("records");
    const results = await collection.find({}).toArray();
    res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/records/:id - Get a single record by id
router.get("/:id", async (req, res, next) => {
  try {
    const db = getDB();
    const collection = db.collection("records");

    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const query = { _id: new ObjectId(req.params.id) };
    const result = await collection.findOne(query);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Record not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/records - Create a new record
router.post("/", async (req, res, next) => {
  try {
    const { name, position, level } = req.body;

    // Basic validation
    if (!name || !position || !level) {
      return res.status(400).json({
        success: false,
        error: "Please provide name, position, and level",
      });
    }

    const db = getDB();
    const collection = db.collection("records");

    const newDocument = {
      name,
      position,
      level,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await collection.insertOne(newDocument);

    res.status(201).json({
      success: true,
      data: {
        _id: result.insertedId,
        ...newDocument,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/records/:id - Update a record by id
router.patch("/:id", async (req, res, next) => {
  try {
    const db = getDB();
    const collection = db.collection("records");

    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const query = { _id: new ObjectId(req.params.id) };

    // Check if record exists
    const existing = await collection.findOne(query);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Record not found",
      });
    }

    const updates = {
      $set: {
        ...req.body,
        updatedAt: new Date(),
      },
    };

    const result = await collection.updateOne(query, updates);

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Record not found",
      });
    }

    // Get updated document
    const updated = await collection.findOne(query);

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/records/:id - Replace a record by id
router.put("/:id", async (req, res, next) => {
  try {
    const { name, position, level } = req.body;

    // Basic validation
    if (!name || !position || !level) {
      return res.status(400).json({
        success: false,
        error: "Please provide name, position, and level",
      });
    }

    const db = getDB();
    const collection = db.collection("records");

    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const query = { _id: new ObjectId(req.params.id) };

    const replacement = {
      name,
      position,
      level,
      updatedAt: new Date(),
    };

    const result = await collection.replaceOne(query, replacement);

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Record not found",
      });
    }

    const updated = await collection.findOne(query);

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/records/:id - Delete a record
router.delete("/:id", async (req, res, next) => {
  try {
    const db = getDB();
    const collection = db.collection("records");

    // Validate ObjectId format
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
      });
    }

    const query = { _id: new ObjectId(req.params.id) };
    const result = await collection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Record not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Record deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
