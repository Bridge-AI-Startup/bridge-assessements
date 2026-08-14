import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import SubmissionModel from "../models/submission.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import { evaluateTranscript } from "../services/evaluation/orchestrator.js";
import { validateCriterion } from "../services/evaluation/validator.js";
import { suggestCriteria } from "../services/evaluation/suggestCriteria.js";
import type { TranscriptEvent } from "../types/evaluation.js";
import type { CriterionEvidenceProfile } from "../prompts/index.js";
import { ensureProctoringTranscriptAndEvaluate } from "./submission.js";

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
 * With submissionId: ownership-checked kickoff of the same background pipeline
 * submit uses (workflow capture, then screen-recording fallback for "both").
 * Returns 202 { started: true }; poll the submission for the report.
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
      const criteriaList = assessment.evaluationCriteria ?? [];
      if (criteriaList.length === 0) {
        return res.status(400).json({
          error: "Assessment has no evaluation criteria configured.",
        });
      }

      // Same pipeline submit already kicks off (workflow, then screen fallback
      // for "both"). Run it in the background so the dashboard is not blocked
      // on transcript generation.
      await SubmissionModel.findByIdAndUpdate(submissionId, {
        $set: { evaluationStatus: "pending", evaluationError: null },
      });
      ensureProctoringTranscriptAndEvaluate(submissionId).catch((err) => {
        console.error(
          `[evaluate] ensureProctoringTranscriptAndEvaluate failed for ${submissionId}:`,
          err
        );
        SubmissionModel.findByIdAndUpdate(submissionId, {
          $set: {
            evaluationStatus: "failed",
            evaluationError:
              err instanceof Error ? err.message : "Evaluation failed.",
          },
        }).catch(() => {});
      });
      return res.status(202).json({ started: true });
    }

    const report = await evaluateTranscript(transcript!, criteria!);
    return res.status(200).json({ report });
  } catch (e) {
    next(e);
  }
};

export type ValidateCriterionRequest = {
  criterion: string;
  evidence_mode?: string;
};

/**
 * Which record a criterion will be graded against.
 *
 * Only the legacy `screen` mode is graded from video. `workflow` and `both`
 * grade the hook stream, and `none` grades nothing at all — but an employer
 * writing criteria under `none` is writing them for the mode they would turn
 * on, so it maps to workflow rather than to the legacy path.
 */
function evidenceProfileFor(mode?: string): CriterionEvidenceProfile {
  return mode === "screen" ? "screen" : "workflow";
}

/**
 * POST /api/evaluation/validate-criterion
 * Body: { criterion: string, evidence_mode?: string }
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
    const { criterion, evidence_mode } = req.body as ValidateCriterionRequest;
    const result = await validateCriterion(
      criterion,
      evidenceProfileFor(evidence_mode)
    );
    return res.status(200).json(result);
  } catch (e) {
    next(e);
  }
};

export type SuggestCriteriaRequest = {
  job_description: string;
  evidence_mode?: string;
};

/**
 * POST /api/evaluation/suggest-criteria
 * Body: { job_description: string, evidence_mode?: string }
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
    const { job_description, evidence_mode } =
      req.body as SuggestCriteriaRequest;
    const suggested_criteria = await suggestCriteria(
      job_description,
      evidenceProfileFor(evidence_mode)
    );
    return res.status(200).json({ suggested_criteria });
  } catch (e) {
    next(e);
  }
};
