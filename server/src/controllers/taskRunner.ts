import { RequestHandler } from "express";
import { executeTask, executeAllTasks } from "../services/taskRunner/taskRunner.js";
import SubmissionModel from "../models/submission.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";

/**
 * Execute a single task for a submission
 * POST /api/tasks/:submissionId/execute/:taskId
 * Employer only (auth required)
 */
export const executeTaskForSubmission: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId, taskId } = req.params;
    const uid = (req as any).user?.uid;

    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify submission belongs to user's assessment
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Execute task
    const result = await executeTask(submissionId, taskId);

    // Save result to submission
    if (!submission.llmWorkflow) {
      submission.llmWorkflow = {
        trace: {
          sessionId: "",
          events: [],
          totalTokens: 0,
          totalCost: 0,
          totalTime: 0,
          totalCalls: 0,
        },
        taskResults: [],
        scores: {},
        evaluation: {
          harnessVersion: "1.0.0",
          tasksCompleted: 0,
          tasksTotal: 0,
        },
      };
    }

    submission.llmWorkflow.taskResults.push(result);
    await submission.save();

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Execute all tasks for a submission
 * POST /api/tasks/:submissionId/execute-all
 * Employer only (auth required)
 */
export const executeAllTasksForSubmission: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const uid = (req as any).user?.uid;

    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify ownership
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get all tasks (for now, use default tasks)
    const TaskConfigModel = (await import("../models/taskConfig.js")).default;
    const tasks = await TaskConfigModel.find({});

    // Execute all tasks
    const results = await executeAllTasks(submissionId);

    // Save results
    if (!submission.llmWorkflow) {
      submission.llmWorkflow = {
        trace: {
          sessionId: "",
          events: [],
          totalTokens: 0,
          totalCost: 0,
          totalTime: 0,
          totalCalls: 0,
        },
        taskResults: [],
        scores: {},
        evaluation: {
          harnessVersion: "1.0.0",
          tasksCompleted: 0,
          tasksTotal: 0,
        },
      };
    }

    submission.llmWorkflow.taskResults = results;
    submission.llmWorkflow.evaluation.tasksCompleted = results.filter(
      (r) => r.status === "passed"
    ).length;
    submission.llmWorkflow.evaluation.tasksTotal = results.length;
    await submission.save();

    res.json({ results });
  } catch (error) {
    next(error);
  }
};
