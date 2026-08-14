/**
 * Tie out an in-progress attempt after timeLimit + grace, even if the
 * candidate closed the tab. Same outcome as the client recording-only
 * submit: status expired, capture closed, observational eval kicked.
 */

import SubmissionModel from "../../models/submission.js";
import { closeAttemptSessions } from "./closeAttempt.js";
import { getSubmissionTimingWindow } from "../../utils/submissionTiming.js";

const REAP_BATCH = 80;

function kickObservationalEvaluation(
  submissionId: string,
  assessment: { evaluationCriteria?: unknown } | null | undefined
): void {
  const hasEvaluationCriteria =
    Array.isArray(assessment?.evaluationCriteria) &&
    assessment.evaluationCriteria.length > 0;

  if (!hasEvaluationCriteria) {
    void SubmissionModel.findByIdAndUpdate(submissionId, {
      $set: {
        evaluationStatus: "failed",
        evaluationError: "Assessment has no evaluation criteria configured.",
      },
    }).catch(() => {});
    return;
  }

  void SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: { evaluationStatus: "pending", evaluationError: null },
  })
    .then(async () => {
      const { ensureProctoringTranscriptAndEvaluate } = await import(
        "../../controllers/submission.js"
      );
      return ensureProctoringTranscriptAndEvaluate(submissionId);
    })
    .catch((err) => {
      console.error(
        `[finalizeExpired] ensureProctoringTranscriptAndEvaluate failed for ${submissionId}:`,
        err
      );
      void SubmissionModel.findByIdAndUpdate(submissionId, {
        $set: {
          evaluationStatus: "failed",
          evaluationError:
            err instanceof Error ? err.message : "Evaluation failed.",
        },
      }).catch(() => {});
    });
}

/**
 * Mark an in-progress attempt expired, close capture, kick evaluation.
 * Returns true when this call performed the expire. Idempotent otherwise
 * (still closes leftover sessions).
 */
export async function expireAttemptAndClose(
  submissionId: string,
  options?: { timeSpent?: number }
): Promise<boolean> {
  const set: Record<string, unknown> = {
    status: "expired",
    submittedAt: new Date(),
  };
  if (options?.timeSpent != null) {
    set.timeSpent = options.timeSpent;
  }

  const updated = await SubmissionModel.findOneAndUpdate(
    { _id: submissionId, status: "in-progress" },
    { $set: set },
    { new: true }
  ).populate("assessmentId", "evaluationCriteria");

  await closeAttemptSessions(submissionId);

  if (!updated) return false;

  kickObservationalEvaluation(
    submissionId,
    updated.assessmentId as { evaluationCriteria?: unknown }
  );
  return true;
}

/**
 * Sweep in-progress attempts whose grace window has closed.
 * Fire-and-forget from the process scheduler; never throws to the caller.
 */
export async function reapExpiredInProgressAttempts(): Promise<number> {
  try {
    const rows = await SubmissionModel.find({
      status: "in-progress",
      startedAt: { $ne: null },
    })
      .select("_id startedAt assessmentId")
      .populate("assessmentId", "timeLimit")
      .limit(REAP_BATCH)
      .lean();

    let expired = 0;
    for (const row of rows) {
      const timing = getSubmissionTimingWindow(row, row.assessmentId as any);
      if (!timing.isBeyondGrace) continue;
      const did = await expireAttemptAndClose(String(row._id), {
        timeSpent: Math.floor(timing.elapsedMinutes ?? 0),
      });
      if (did) expired += 1;
    }
    if (expired > 0) {
      console.log(
        `[attempt-reaper] expired ${expired} in-progress attempt(s) past grace`
      );
    }
    return expired;
  } catch (err) {
    console.error(
      "[attempt-reaper] sweep failed:",
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

const DEFAULT_INTERVAL_MS = 60_000;
let intervalId: ReturnType<typeof setInterval> | null = null;

function getIntervalMs(): number {
  const raw = process.env.ATTEMPT_REAPER_INTERVAL_MS;
  if (raw == null || raw === "") return DEFAULT_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

export function startAttemptReaper(): void {
  if (process.env.ATTEMPT_REAPER_ENABLED === "false") return;
  if (intervalId) return;

  const intervalMs = getIntervalMs();
  intervalId = setInterval(() => {
    void reapExpiredInProgressAttempts();
  }, intervalMs);
  console.log(`[attempt-reaper] started (interval ${intervalMs}ms)`);
  void reapExpiredInProgressAttempts();
}

export function stopAttemptReaper(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  console.log("[attempt-reaper] stopped");
}
