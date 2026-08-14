import { completeProctoringForSubmission } from "../capture/sessionVideoMerge.js";
import { closeCaptureForSubmission } from "../workflowCapture/finalize.js";

/**
 * End screen capture and workflow capture for an attempt.
 * The proctoring status update is awaited so leftover chunk/frame POSTs 409
 * as a backstop — closing is this function, not the 409. Episode summarisation
 * stays unawaited (LLM). Idempotent; safe on already-closed sessions.
 */
export async function closeAttemptSessions(submissionId: string): Promise<void> {
  await completeProctoringForSubmission(submissionId);
  void closeCaptureForSubmission(submissionId);
}
