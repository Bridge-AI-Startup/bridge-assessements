/**
 * Closing a capture session.
 *
 * The capture kit only ends a session when it calls `POST /complete` itself.
 * Submitting through the web app never told it to, so sessions sat `active`
 * forever — and because episodes are computed once when capture ends, a
 * finished assessment showed a reviewer "capture is still in progress" and no
 * episode summary at all.
 *
 * Submitting the assessment IS the end of the capture, so every submit path
 * calls this. It is deliberately safe to call more than once and from more than
 * one place at a time: the submit handler fires it, and the evaluation path
 * calls it again as a backstop in case a submit predates this code.
 */

import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
} from "../../models/workflowCapture.js";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import { groupIntoEpisodes } from "./episodes.js";
import { findCaptureSessionForSubmission } from "./evaluate.js";

/**
 * How long one attempt at building episodes may hold the claim.
 *
 * Long enough that two callers seconds apart never both pay for the LLM call,
 * short enough that a process killed mid-attempt does not strand the session
 * until someone notices. Grouping takes single-digit seconds.
 */
const EPISODE_LEASE_MS = 5 * 60 * 1000;

/**
 * Mark a capture session completed and build + persist its episode summary.
 *
 * Never throws: it runs unawaited off the submit response, and a failure to
 * summarise must not affect the candidate's submission or the stored verdicts.
 */
export async function finalizeCaptureSession(
  captureSessionId: string
): Promise<void> {
  try {
    const session: any = await WorkflowCaptureSessionModel.findById(
      captureSessionId
    ).lean();
    if (!session) return;

    const needsClose = session.status !== "completed";
    const needsStopVideo = session.video?.status === "recording";
    if (needsClose || needsStopVideo) {
      const completedAt = new Date();
      const set: Record<string, unknown> = {};
      if (needsClose) {
        set.status = "completed";
        set.completedAt = completedAt;
      }
      // Kit video is optional and independent of proctoring. If it was still
      // recording when the attempt ended, close it so leftover chunks 409.
      if (needsStopVideo) {
        set["video.status"] = "ready";
        set["video.endedAt"] = completedAt;
        const segments = Array.isArray(session.video.segments)
          ? session.video.segments
          : [];
        const openIndex = segments.findIndex((s: { wallEndedAt?: Date | null }) => !s.wallEndedAt);
        if (openIndex >= 0) {
          set[`video.segments.${openIndex}.wallEndedAt`] = completedAt;
          set[`video.segments.${openIndex}.endReason`] = "submission";
        }
      }
      await WorkflowCaptureSessionModel.updateOne(
        { _id: session._id },
        { $set: set }
      );
    }

    if (session.submissionId) {
      const hasProctoring = await ProctoringSessionModel.exists({
        submissionId: session.submissionId,
      });
      if (hasProctoring) {
        // `both`: episodes wait until the Review movie is classified so they
        // can describe hook-silent stretches. evaluateWorkflowCaptureForSubmission
        // awaits merge + classify then computes them.
        return;
      }
    }

    if (Array.isArray(session.episodes) && session.episodes.length > 0) return;

    // Claim the work atomically before spending an LLM call. Submit and the
    // evaluation backstop can land within milliseconds of each other, and a
    // read-then-write guard would let both through — paying twice and racing to
    // overwrite each other's episode set.
    //
    // The claim is a *lease*, not a permanent marker. It is written before an
    // LLM call that takes seconds, this runs unawaited in the background, and
    // the process restarts on every deploy — so a claim that is never released
    // is not a rare crash, it is routine. Treating one as final meant a session
    // could reach a state where grouping worked perfectly but no code path
    // would ever run it again, and the interviewer agent silently lost its best
    // context. An expired lease is therefore re-claimable: we only get here
    // when episodes are still empty, so whoever held it did not finish.
    const now = Date.now();
    const leaseCutoff = new Date(now - EPISODE_LEASE_MS);
    const claim = await WorkflowCaptureSessionModel.updateOne(
      {
        _id: session._id,
        $or: [
          { episodesComputedAt: null },
          { episodesComputedAt: { $exists: false } },
          { episodesComputedAt: { $lt: leaseCutoff } },
        ],
      },
      { $set: { episodesComputedAt: new Date(now) } }
    );
    if (claim.modifiedCount !== 1) return;

    const events = await WorkflowEventModel.find({ sessionId: session._id })
      .sort({ at: 1 })
      .lean();

    let episodes: unknown[] = [];
    try {
      episodes = await groupIntoEpisodes(events as any, {
        startedAt: session.startedAt || session.createdAt,
      });
    } catch (err) {
      // Release the claim so a later re-run (or the reviewer's "Build episode
      // summary" button) can try again instead of being locked out by a
      // timestamp that never produced anything.
      await WorkflowCaptureSessionModel.updateOne(
        { _id: session._id },
        { $set: { episodesComputedAt: null } }
      );
      throw err;
    }

    if (!episodes.length) {
      await WorkflowCaptureSessionModel.updateOne(
        { _id: session._id },
        { $set: { episodesComputedAt: null } }
      );
      return;
    }

    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      { $set: { episodes } }
    );
    console.log(
      `[workflow-capture] session ${captureSessionId}: closed, persisted ${episodes.length} episodes`
    );
  } catch (err) {
    console.error(
      `[workflow-capture] Could not finalize session ${captureSessionId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Close whatever capture session belongs to a submission. No-op when the
 * candidate never ran the capture kit, which is an ordinary state.
 */
export async function closeCaptureForSubmission(
  submissionId: string
): Promise<void> {
  try {
    const capture: any = await findCaptureSessionForSubmission(submissionId);
    if (!capture) return;
    await finalizeCaptureSession(capture._id.toString());
  } catch (err) {
    console.error(
      `[workflow-capture] Could not close capture for submission ${submissionId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
