/**
 * Candidate attempt clock. The 5-minute grace after `timeLimit` is the same
 * window the client uses (`FINAL_SUBMISSION_GRACE_SECONDS` in
 * CandidateAssessment) — keep them in lockstep.
 */

export const FINAL_SUBMISSION_GRACE_MINUTES = 5;

export type SubmissionTimingWindow = {
  elapsedMinutes: number | null;
  isLate: boolean;
  isBeyondGrace: boolean;
};

export function getSubmissionTimingWindow(
  submission: { startedAt?: Date | string | null },
  assessment: { timeLimit?: number | null } | null | undefined
): SubmissionTimingWindow {
  if (!assessment?.timeLimit || !submission?.startedAt) {
    return { elapsedMinutes: null, isLate: false, isBeyondGrace: false };
  }

  const elapsedMinutes =
    (Date.now() - new Date(submission.startedAt).getTime()) / (1000 * 60);
  const isLate = elapsedMinutes > assessment.timeLimit;
  const isBeyondGrace =
    elapsedMinutes > assessment.timeLimit + FINAL_SUBMISSION_GRACE_MINUTES;

  return { elapsedMinutes, isLate, isBeyondGrace };
}
