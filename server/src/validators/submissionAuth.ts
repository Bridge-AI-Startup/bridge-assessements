import { NextFunction, Request, Response } from "express";
import { AuthError } from "../errors/auth.js";
import { decodeAuthToken } from "../utils/auth.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";
import SubmissionModel from "../models/submission.js";

type RequestWithUserId = Request & {
  userId?: string;
  uid?: string;
};

/**
 * Middleware to verify access to a submission
 * Allows access if:
 * 1. User is authenticated (employer) and owns the assessment, OR
 * 2. A valid token is provided in query/body that matches the submission
 *
 * This is used for endpoints that can be accessed by both candidates (via token) and employers (via auth)
 */
export const verifySubmissionAccess = async (
  req: RequestWithUserId,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { submissionId } = req.params;

    if (!submissionId) {
      res.status(400).json({ error: "submissionId is required" });
      return;
    }

    // Try to get submission to check ownership
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const assessment = submission.assessmentId as any;

    // Option 1: Check if user is authenticated (employer access)
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer")
      ? authHeader.split(" ")[1]
      : null;

    if (token) {
      try {
        const userInfo = await decodeAuthToken(token);
        const userId = await getUserIdFromFirebaseUid(userInfo.uid);

        // Check if user owns the assessment
        if (assessment && assessment.userId?.toString() === userId) {
          req.body.uid = userInfo.uid;
          req.userId = userId;
          return next();
        }
      } catch (authError) {
        // Auth token invalid, continue to check token-based access
      }
    }

    // Option 2: Check token-based access (candidate access)
    // Token can be in query params, body, or params
    const candidateToken =
      (req.query.token as string) || req.body.token || req.params.token;

    if (candidateToken && typeof candidateToken === "string") {
      // Verify token matches this submission
      if (submission.token === candidateToken) {
        return next();
      }
    }

    // If neither auth nor token access is valid, deny
    res
      .status(403)
      .json({
        error: "Access denied. Invalid token or insufficient permissions.",
      });
  } catch (error) {
    console.error("Error in verifySubmissionAccess:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Middleware to verify token-based access only (for candidate endpoints)
 * Requires a token parameter that matches the submission
 */
export const verifySubmissionToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { submissionId } = req.params;
    const token = req.query.token || req.body.token || req.params.token;

    if (!submissionId) {
      res.status(400).json({ error: "submissionId is required" });
      return;
    }

    if (!token || typeof token !== "string") {
      res.status(401).json({ error: "Token is required" });
      return;
    }

    const submission = await SubmissionModel.findOne({
      _id: submissionId,
      token: token,
    });

    if (!submission) {
      res.status(403).json({ error: "Invalid token for this submission" });
      return;
    }

    next();
  } catch (error) {
    console.error("Error in verifySubmissionToken:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
