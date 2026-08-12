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

/**
 * Whether the captured record looks complete.
 *
 * We cannot stop a candidate deleting the kit from their own machine — anything
 * running in their environment can be removed. What we can do is make removal
 * *visible*: capture that never started, or that stopped long before the work
 * was submitted, is reported rather than silently producing a thin record that
 * looks like a quiet candidate.
 *
 * This is deliberately descriptive, not accusatory. Capture also stops for
 * innocent reasons — a laptop sleeping, a network drop, someone finishing early
 * — so it surfaces the facts and leaves the judgement to a human.
 */
export type CaptureIntegrityStatus =
  | "complete"
  | "stopped_early"
  | "sparse"
  | "missing";

export interface CaptureIntegrity {
  status: CaptureIntegrityStatus;
  /** Seconds between the last captured event and submission. */
  silentBeforeSubmitSeconds: number | null;
  capturedSeconds: number | null;
  eventCount: number;
  promptCount: number;
  note: string;
}

/** Capture going quiet for this long before submit is worth flagging. */
const STOPPED_EARLY_THRESHOLD_SECONDS = 10 * 60;
/** Below this, there is not enough of a record to grade confidently. */
const SPARSE_PROMPT_THRESHOLD = 3;

export function assessCaptureIntegrity(
  events: Array<{ at: Date | string; type: string }>,
  options: { submittedAt?: Date | string | null; startedAt?: Date | string | null }
): CaptureIntegrity {
  const times = events
    .map((e) => new Date(e.at).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const promptCount = events.filter((e) => e.type === "user_prompt").length;

  if (times.length === 0) {
    return {
      status: "missing",
      silentBeforeSubmitSeconds: null,
      capturedSeconds: null,
      eventCount: 0,
      promptCount: 0,
      note: "No workflow activity was captured. The candidate may not have completed the capture setup, or may not have trusted the folder in their AI tool.",
    };
  }

  const first = times[0];
  const last = times[times.length - 1];
  const capturedSeconds = Math.round((last - first) / 1000);
  const submittedMs = options.submittedAt
    ? new Date(options.submittedAt).getTime()
    : null;
  const silentBeforeSubmitSeconds =
    submittedMs && Number.isFinite(submittedMs)
      ? Math.max(0, Math.round((submittedMs - last) / 1000))
      : null;

  if (
    silentBeforeSubmitSeconds != null &&
    silentBeforeSubmitSeconds > STOPPED_EARLY_THRESHOLD_SECONDS
  ) {
    return {
      status: "stopped_early",
      silentBeforeSubmitSeconds,
      capturedSeconds,
      eventCount: times.length,
      promptCount,
      note: `Capture stopped ${Math.round(silentBeforeSubmitSeconds / 60)} minutes before the work was submitted, so the last stretch of work was not recorded.`,
    };
  }

  if (promptCount < SPARSE_PROMPT_THRESHOLD) {
    return {
      status: "sparse",
      silentBeforeSubmitSeconds,
      capturedSeconds,
      eventCount: times.length,
      promptCount,
      note: `Only ${promptCount} AI prompt(s) were captured. Either little AI assistance was used, or capture was active for only part of the session.`,
    };
  }

  return {
    status: "complete",
    silentBeforeSubmitSeconds,
    capturedSeconds,
    eventCount: times.length,
    promptCount,
    note: "Capture ran through to submission.",
  };
}

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
  options?: { groundings?: unknown; submittedAt?: Date | string | null }
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
        // Whether the record itself is complete — a reviewer needs to know the
        // difference between "did little" and "we captured little".
        capture: assessCaptureIntegrity(events as any, {
          submittedAt: options?.submittedAt ?? null,
          startedAt,
        }),
      },
    },
    timelineEvents: timeline.length,
    citationsKept: validated.totalKept,
    citationsDropped: validated.totalDropped,
    invalidatedCriteria: validated.invalidatedCriteria,
  };
}
