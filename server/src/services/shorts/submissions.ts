import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";
import {
  getPlayVoteModel,
  getPlayVoteRoundModel,
} from "../../models/shorts/vote.js";
import {
  connectPlaySandbox,
  filterPlayPublicFiles,
  killPlaySandbox,
  snapshotProjectFiles,
} from "./sandbox.js";
import { snapshotServerlessSubmission } from "./serverlessMake.js";
import { linkAnonymousId } from "./account.js";
import { isWithinSubmitGrace, isWithinSubmitHold } from "./sessionPersist.js";
import { assertNotStarterOnly } from "./starterDetection.js";
import type { Sandbox } from "e2b";

export type SubmitResult = {
  submissionId: string;
  displayName: string;
  fileCount: number;
  totalBytes: number;
  challenge: {
    slug: string;
    challengeDate: string;
  };
};

export type AdminSubmissionSummary = {
  id: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: string;
  anonymousId: string;
};

export type AdminSubmissionDetail = AdminSubmissionSummary & {
  sessionId: string;
  files: Array<{ path: string; content: string }>;
};

/**
 * Snapshot the active session workspace and persist as a PlaySubmission.
 */
export async function submitSession(input: {
  sessionId: string;
  anonymousId: string;
  displayName: string;
  /** Verified Firebase uid when the builder was signed in at submit time. */
  firebaseUid?: string | null;
}): Promise<SubmitResult> {
  const anonymousId = input.anonymousId.trim();
  const displayName = input.displayName.trim();
  const firebaseUid = input.firebaseUid?.trim() || null;
  if (!anonymousId) {
    throw createHttpError(400, "anonymousId is required");
  }
  if (!displayName || displayName.length > 40) {
    throw createHttpError(400, "displayName must be 1–40 characters");
  }
  if (!Types.ObjectId.isValid(input.sessionId)) {
    throw createHttpError(400, "invalid session id");
  }

  const BuildSession = getPlayBuildSessionModel();
  const session = await BuildSession.findById(input.sessionId);
  if (!session) {
    throw createHttpError(404, "session_not_found");
  }
  if (session.anonymousId !== anonymousId) {
    throw createHttpError(403, "session_forbidden");
  }
  if (session.status === "submitted") {
    throw createHttpError(409, "session_already_submitted");
  }
  // Building stops at expiresAt, but the finished work can still be saved for a
  // short grace window — a session that timed out seconds ago is `expired`
  // rather than `active`, so both statuses are allowed while grace holds.
  // Opening the submit dialog stops the submit clock outright (`submitHoldAt`),
  // which is what keeps a signup or Google popup from eating a finished build.
  const inGrace =
    isWithinSubmitGrace(session.expiresAt) ||
    isWithinSubmitHold(session.submitHoldAt);
  if (session.status !== "active" && !(session.status === "expired" && inGrace)) {
    throw createHttpError(400, `session_not_active:${session.status}`);
  }
  if (
    session.expiresAt &&
    session.expiresAt.getTime() <= Date.now() &&
    !inGrace
  ) {
    session.status = "expired";
    await session.save();
    throw createHttpError(400, "session_expired");
  }
  const isServerless = session.makeMode === "serverless";

  let snapshot: { files: Array<{ path: string; content: string }>; totalBytes: number };
  let sandbox: Sandbox | null = null;

  if (isServerless) {
    // Serverless: the generated file(s) already live on the session snapshot.
    snapshot = snapshotServerlessSubmission(session);
  } else {
    // In the grace window the box may already be reaped. Building stopped at
    // expiry, so the persisted snapshot is the final state — submit that
    // instead of failing the builder for a sandbox they no longer control.
    if (!session.e2bSandboxId) {
      if (!inGrace) throw createHttpError(502, "session has no sandbox");
    } else {
      try {
        sandbox = await connectPlaySandbox(session.e2bSandboxId, {
          timeoutMs: 60 * 60 * 1000,
        });
      } catch {
        if (!inGrace) {
          session.status = "expired";
          session.error = "Sandbox no longer reachable";
          await session.save();
          throw createHttpError(502, "Sandbox no longer reachable");
        }
      }
    }

    if (sandbox) {
      try {
        snapshot = await snapshotProjectFiles(sandbox);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to snapshot project";
        const status =
          message.includes("exceeds") || message.includes("too many")
            ? 413
            : 502;
        throw createHttpError(status, message);
      }
    } else {
      snapshot = snapshotServerlessSubmission(session);
    }
  }

  // Reject unchanged / near-empty starter before persisting or killing the sandbox
  assertNotStarterOnly(snapshot.files);

  const Submission = getPlaySubmissionModel();
  const submittedAt = new Date();
  // Each submit is its own entry — never overwrite an earlier build. A fresh
  // document also means fresh rating defaults, so a new build cannot inherit
  // votes an earlier one earned.
  const doc = await Submission.create({
    anonymousId,
    // Signed in at submit time → the build belongs to the account, not just to
    // this browser. Someone who signs in from the submit dialog gets the build
    // they just made attributed immediately.
    ...(firebaseUid ? { firebaseUid } : {}),
    displayName,
    challengeSlug: session.challengeSlug,
    challengeDate: session.challengeDate,
    sessionId: session._id,
    files: snapshot.files,
    fileCount: snapshot.files.length,
    totalBytes: snapshot.totalBytes,
    submittedAt,
  });

  // Claim the browser id too, so everything else built here follows the account.
  // Best-effort: the submission itself is already saved and already attributed.
  if (firebaseUid) {
    await linkAnonymousId({ firebaseUid, anonymousId }).catch(() => undefined);
  }

  session.status = "submitted";
  session.previewUrl = undefined;
  await session.save();

  // Only E2B sessions have a sandbox to tear down.
  if (sandbox) {
    await killPlaySandbox(sandbox);
  }

  return {
    submissionId: doc._id.toString(),
    displayName: doc.displayName,
    fileCount: doc.fileCount,
    totalBytes: doc.totalBytes,
    challenge: {
      slug: doc.challengeSlug,
      challengeDate: doc.challengeDate,
    },
  };
}

export async function listSubmissions(options: {
  challengeDate?: string;
  limit?: number;
} = {}): Promise<AdminSubmissionSummary[]> {
  const Submission = getPlaySubmissionModel();
  const limit = options.limit ?? 50;
  const filter: Record<string, unknown> = {};
  if (options.challengeDate) {
    filter.challengeDate = options.challengeDate;
  }

  const docs = await Submission.find(filter)
    .select(
      "displayName challengeSlug challengeDate fileCount totalBytes submittedAt anonymousId",
    )
    .sort({ submittedAt: -1 })
    .limit(limit)
    .lean();

  return docs.map((doc) => ({
    id: String(doc._id),
    displayName: doc.displayName,
    challengeSlug: doc.challengeSlug,
    challengeDate: doc.challengeDate,
    fileCount: doc.fileCount,
    totalBytes: doc.totalBytes,
    submittedAt: new Date(doc.submittedAt).toISOString(),
    anonymousId: doc.anonymousId,
  }));
}

export type DeleteSubmissionResult = {
  id: string;
  displayName: string;
  challengeDate: string;
  /** Head-to-head votes removed along with the build. */
  votesRemoved: number;
};

/**
 * Admin: remove a submission and the vote records that point at it.
 *
 * Ratings are updated incrementally as votes land, so deleting a build does
 * **not** claw back the points its opponents already won from beating it —
 * unwinding that would mean replaying every vote in the round. What this does
 * guarantee is no dangling references: the build leaves the gallery,
 * leaderboard and matchup pool, its votes go with it (which also frees those
 * voters to be shown other pairs), and any round recap that named it is
 * scrubbed.
 */
export async function deleteSubmission(
  id: string,
): Promise<DeleteSubmissionResult> {
  if (!Types.ObjectId.isValid(id)) {
    throw createHttpError(400, "invalid submission id");
  }
  const Submission = getPlaySubmissionModel();
  const doc = await Submission.findById(id);
  if (!doc) {
    throw createHttpError(404, "submission_not_found");
  }

  const displayName = doc.displayName;
  const challengeDate = doc.challengeDate;

  const Vote = getPlayVoteModel();
  const votes = await Vote.deleteMany({
    $or: [{ winnerId: doc._id }, { loserId: doc._id }],
  });

  const VoteRound = getPlayVoteRoundModel();
  await VoteRound.updateMany(
    { challengeDate },
    {
      $pull: { seenSubmissionIds: id },
      $unset: { [`rankSnapshot.${id}`]: "" },
    },
  );

  await doc.deleteOne();

  return {
    id,
    displayName,
    challengeDate,
    votesRemoved: votes.deletedCount ?? 0,
  };
}

export async function getSubmissionById(
  id: string,
): Promise<AdminSubmissionDetail> {
  if (!Types.ObjectId.isValid(id)) {
    throw createHttpError(400, "invalid submission id");
  }
  const Submission = getPlaySubmissionModel();
  const doc = await Submission.findById(id).lean();
  if (!doc) {
    throw createHttpError(404, "submission_not_found");
  }

  return {
    id: String(doc._id),
    displayName: doc.displayName,
    challengeSlug: doc.challengeSlug,
    challengeDate: doc.challengeDate,
    fileCount: doc.fileCount,
    totalBytes: doc.totalBytes,
    submittedAt: new Date(doc.submittedAt).toISOString(),
    anonymousId: doc.anonymousId,
    sessionId: String(doc.sessionId),
    files: filterPlayPublicFiles(doc.files || []).map(
      (f: { path: string; content: string }) => ({
        path: f.path,
        content: f.content,
      }),
    ),
  };
}
