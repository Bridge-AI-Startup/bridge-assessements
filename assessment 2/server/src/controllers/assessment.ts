import type { RequestHandler } from "express";
import { validationResult } from "express-validator";
import {
  createAssessment as createAssessmentRecord,
  findAssessmentByIdAndUser,
} from "../repositories/inMemoryStore.js";

export const createAssessment: RequestHandler = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "VALIDATION", details: errors.array() });
    }
    const userId = req.employer!.userId;
    const { title, description, timeLimit } = req.body as {
      title: string;
      description?: string;
      timeLimit: number;
    };
    const a = createAssessmentRecord({
      userId,
      title: title.trim(),
      description: String(description ?? "").trim(),
      timeLimit: Number(timeLimit),
    });
    res.status(201).json({
      id: a.id,
      title: a.title,
      description: a.description,
      timeLimit: a.timeLimit,
    });
  } catch (e) {
    next(e);
  }
};

export const getAssessment: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.employer!.userId;
    const a = findAssessmentByIdAndUser(req.params.id, userId);
    if (!a) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Assessment not found." });
    }
    res.status(200).json({
      id: a.id,
      title: a.title,
      description: a.description,
      timeLimit: a.timeLimit,
    });
  } catch (e) {
    next(e);
  }
};
