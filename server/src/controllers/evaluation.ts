import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import { evaluateTranscript } from "../services/evaluation/orchestrator.js";
import { getProctoringTranscriptForSubmission } from "../services/evaluation/proctoringTranscriptAdapter.js";
import { validateCriterion } from "../services/evaluation/validator.js";
import { suggestCriteria } from "../services/evaluation/suggestCriteria.js";
import type { TranscriptEvent } from "../types/evaluation.js";
import { generateTranscript } from "../ai/transcript/generator.js";

async function getUserIdFromFirebaseUid(firebaseUid: string): Promise<string> {
  const UserModel = (await import("../models/user.js")).default;
  const user = await UserModel.findOne({ firebaseUid });
  if (!user) {
    throw AuthError.INVALID_AUTH_TOKEN;
  }
  return user._id.toString();
}

export type EvaluateRequest = {
  submissionId?: string;
  transcript?: TranscriptEvent[];
  criteria?: string[];
  uid?: string;
};

/**
 * POST /api/evaluation/evaluate
 * Body: { submissionId } OR { transcript, criteria } for dry-run.
 * With submissionId: loads transcript from Submission.screenRecordingTranscript,
 * criteria from Assessment.evaluationCriteria, runs orchestrator, persists report.
 * With transcript+criteria: runs orchestrator and returns report (no persist).
 */
export const evaluate: RequestHandler = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    validationErrorParser(errors);

    const { submissionId, transcript, criteria, uid } =
      req.body as EvaluateRequest;

    if (submissionId) {
      const userId = await getUserIdFromFirebaseUid(uid!);
      const submission = await SubmissionModel.findById(submissionId).populate(
        "assessmentId"
      );
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }
      const assessment = submission.assessmentId as {
        userId?: unknown;
        evaluationCriteria?: string[];
        evaluationCriteriaGroundings?: unknown[];
      };
      if (!assessment || assessment.userId?.toString() !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      let screenTranscript = (submission as any).screenRecordingTranscript;
      if (!Array.isArray(screenTranscript) || screenTranscript.length === 0) {
        screenTranscript = await getProctoringTranscriptForSubmission(submissionId);
      }
      if (!screenTranscript || screenTranscript.length === 0) {
        const session = await ProctoringSessionModel.findOne({ submissionId });
        if (session) {
          const status = session.transcript?.status ?? "not_started";
          if (status === "not_started" || status === "failed") {
            try {
              await generateTranscript(session._id.toString());
              screenTranscript = await getProctoringTranscriptForSubmission(submissionId);
            } catch (genErr) {
              const msg = genErr instanceof Error ? genErr.message : String(genErr);
              return res.status(400).json({
                error: `Transcript generation failed: ${msg}. Ensure proctoring captured frames and transcript generation is enabled.`,
              });
            }
          } else if (status === "generating") {
            return res.status(202).json({
              error: "Transcript is still being generated. Please try again in a few minutes.",
            });
          } else {
            screenTranscript = await getProctoringTranscriptForSubmission(submissionId);
          }
        }
      }
      if (!screenTranscript || screenTranscript.length === 0) {
        return res.status(400).json({
          error:
            "No screen recording transcript. The candidate must complete the assessment with proctoring enabled so a transcript can be generated. If proctoring was used, try running evaluation again in a moment.",
        });
      }
      const criteriaList = assessment.evaluationCriteria ?? [];
      if (criteriaList.length === 0) {
        return res.status(400).json({
          error: "Assessment has no evaluation criteria configured.",
        });
      }
      const report = await evaluateTranscript(
        screenTranscript as TranscriptEvent[],
        criteriaList,
        { groundings: assessment.evaluationCriteriaGroundings }
      );
      (submission as any).evaluationReport = report;
      (submission as any).screenRecordingTranscript = screenTranscript;
      (submission as any).evaluationStatus = "completed";
      await submission.save();
      return res.status(200).json({ report });
    }

    const report = await evaluateTranscript(transcript!, criteria!);
    return res.status(200).json({ report });
  } catch (e) {
    next(e);
  }
};

export type ValidateCriterionRequest = {
  criterion: string;
};

/**
 * POST /api/evaluation/validate-criterion
 * Body: { criterion: string }
 * Returns { valid: boolean, reason?: string }
 */
export const validateCriterionHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const errors = validationResult(req);
    validationErrorParser(errors);
    const { criterion } = req.body as ValidateCriterionRequest;
    const result = await validateCriterion(criterion);
    return res.status(200).json(result);
  } catch (e) {
    next(e);
  }
};

export type SuggestCriteriaRequest = {
  job_description: string;
};

/**
 * POST /api/evaluation/suggest-criteria
 * Body: { job_description: string }
 * Returns { suggested_criteria: string[] }
 */
export const suggestCriteriaHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const errors = validationResult(req);
    validationErrorParser(errors);
    const { job_description } = req.body as SuggestCriteriaRequest;
    const suggested_criteria = await suggestCriteria(job_description);
    return res.status(200).json({ suggested_criteria });
  } catch (e) {
    next(e);
  }
};
