/**
 * Grade a workflow-captured session.
 *
 * Deliberately thin: the timeline adapter already converts captured events into
 * the `TranscriptEvent[]` the existing evaluation engine consumes, so this reuses
 * `evaluateTranscript` (grounder → per-criterion evaluator → session summary)
 * rather than building a parallel grading path. The result is the same
 * `EvaluationReport` shape stored on the submission, so every downstream
 * consumer — dashboard, leaderboard score, interview agent — works unchanged.
 *
 * The one addition is citation validation: a judge reading a captured timeline
 * can cite a moment that never happened, and an employer cannot tell the
 * difference. Unverifiable citations are dropped before the report is stored.
 */

import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
} from "../../models/workflowCapture.js";
import { evaluateTranscript } from "../evaluation/orchestrator.js";
import { buildTranscriptEvents } from "./timeline.js";
import { computeMetrics } from "./metrics.js";
import { validateAllEvidence } from "./evidenceValidator.js";
import { logTs } from "../../ai/transcript/logger.js";

export interface WorkflowEvaluationResult {
  report: unknown;
  timelineEvents: number;
  citationsKept: number;
  citationsDropped: number;
  invalidatedCriteria: string[];
}

/** The capture session for a submission, newest first if several exist. */
export async function findCaptureSessionForSubmission(submissionId: string) {
  return WorkflowCaptureSessionModel.findOne({ submissionId })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Build the timeline for a capture session and grade it against the
 * assessment's criteria. Throws with a candidate-safe message when there is
 * nothing gradable — the caller records that as an evaluation failure.
 */
export async function evaluateWorkflowSession(
  captureSessionId: string,
  criteria: string[],
  options?: { groundings?: unknown }
): Promise<WorkflowEvaluationResult> {
  const session: any = await WorkflowCaptureSessionModel.findById(captureSessionId).lean();
  if (!session) throw new Error("Capture session not found.");

  const events = await WorkflowEventModel.find({ sessionId: session._id })
    .sort({ at: 1 })
    .lean();
  if (events.length === 0) {
    throw new Error(
      "No workflow activity was captured for this submission. Did the candidate run the capture setup and trust the folder?"
    );
  }

  const files = await WorkflowFileStateModel.find({ sessionId: session._id })
    .select("path sizeBytes origin")
    .lean();

  const startedAt = session.startedAt || session.createdAt;
  const timeline = buildTranscriptEvents(events as any, { startedAt });
  const metrics = computeMetrics(events as any, files as any, { startedAt });

  const report: any = await evaluateTranscript(timeline, criteria, {
    groundings: options?.groundings as any,
  });

  // Drop citations that do not correspond to captured activity. Doing this
  // after scoring rather than constraining the judge keeps the existing
  // evaluator untouched, and a dropped citation is visible in the logs.
  const validated = validateAllEvidence(report?.criteria ?? [], timeline);
  if (validated.reasons.length > 0) {
    logTs(
      "workflow-eval",
      `dropped ${validated.totalDropped} unverifiable citation(s): ${validated.reasons.slice(0, 5).join("; ")}`
    );
  }

  return {
    report: {
      ...report,
      criteria: validated.results,
      // Deterministic counts travel with the report so a reviewer sees the
      // factual floor beside the judged scores.
      workflowMetrics: metrics,
      evidenceIntegrity: {
        citationsKept: validated.totalKept,
        citationsDropped: validated.totalDropped,
        invalidatedCriteria: validated.invalidatedCriteria,
      },
    },
    timelineEvents: timeline.length,
    citationsKept: validated.totalKept,
    citationsDropped: validated.totalDropped,
    invalidatedCriteria: validated.invalidatedCriteria,
  };
}
