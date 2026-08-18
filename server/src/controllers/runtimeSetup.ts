import { Request, RequestHandler } from "express";
import createHttpError from "http-errors";
import { ZodError } from "zod";
import SubmissionModel from "../models/submission.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";
import {
  createOrResumeSession,
  finalizeSetup,
  getLogs,
  getRuntimeStatus,
  pauseSession,
  getReplayLogs,
  getReplayStatus,
  replayFinalizedConfig,
  restartSession,
  resumeSession,
  runSession,
  saveRuntimeConfig,
  stopReplay,
} from "../services/runtimeSetup/index.js";

function zodMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => i.message).join("; ") || "Invalid runtime config";
  }
  return err instanceof Error ? err.message : "Request failed";
}

export const getStatus: RequestHandler = async (req, res, next) => {
  try {
    const result = await getRuntimeStatus(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const putConfig: RequestHandler = async (req, res, next) => {
  try {
    const result = await saveRuntimeConfig(String(req.params.token || ""), req.body);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return next(createHttpError(400, zodMessage(error)));
    }
    next(error);
  }
};

export const postSession: RequestHandler = async (req, res, next) => {
  try {
    const result = await createOrResumeSession(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postRestart: RequestHandler = async (req, res, next) => {
  try {
    const result = await restartSession(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postRun: RequestHandler = async (req, res, next) => {
  try {
    const result = await runSession(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return next(createHttpError(400, zodMessage(error)));
    }
    next(error);
  }
};

export const getLogLines: RequestHandler = async (req, res, next) => {
  try {
    const after = Number(req.query.after || 0);
    const result = await getLogs(
      String(req.params.token || ""),
      Number.isFinite(after) ? after : 0
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postPause: RequestHandler = async (req, res, next) => {
  try {
    const result = await pauseSession(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postResume: RequestHandler = async (req, res, next) => {
  try {
    const result = await resumeSession(String(req.params.token || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postFinalize: RequestHandler = async (req, res, next) => {
  try {
    const confirmUnverified =
      (req.body as { confirmUnverified?: unknown } | undefined)
        ?.confirmUnverified === true;
    const result = await finalizeSetup(String(req.params.token || ""), {
      confirmUnverified,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return next(createHttpError(400, zodMessage(error)));
    }
    next(error);
  }
};

async function requireEmployerOwnsSubmission(req: Request) {
  const uid =
    (req as { user?: { uid?: string } }).user?.uid ||
    (req.body as { uid?: string } | undefined)?.uid;
  if (!uid) {
    throw createHttpError(401, "Authentication required");
  }
  const userId = await getUserIdFromFirebaseUid(uid);
  const submissionId = String(req.params.submissionId || "");
  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!submission) {
    throw createHttpError(404, "Submission not found");
  }
  const assessment = submission.assessmentId as {
    userId?: { toString(): string };
  };
  if (assessment?.userId?.toString() !== userId) {
    throw createHttpError(403, "Access denied");
  }
  return { submissionId, submission };
}

export const postReplay: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = await requireEmployerOwnsSubmission(req);
    const restart = req.body?.restart === true;
    const result = await replayFinalizedConfig(submissionId, { restart });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getReplayStatusHandler: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = await requireEmployerOwnsSubmission(req);
    const result = await getReplayStatus(submissionId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getReplayLogLines: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = await requireEmployerOwnsSubmission(req);
    const after = Number(req.query.after || 0);
    const result = await getReplayLogs(
      submissionId,
      Number.isFinite(after) ? after : 0
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postReplayStop: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = await requireEmployerOwnsSubmission(req);
    const result = await stopReplay(submissionId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
