import express from "express";
import * as InterviewController from "../controllers/interview.js";

const router = express.Router();

// Start or resume an interview session
router.post("/start", InterviewController.startInterview);

// Submit a candidate answer and advance the interview
router.post("/:sessionId/answer", InterviewController.answerQuestion);

export default router;
