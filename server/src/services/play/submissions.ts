import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlayBuildSessionModel } from "../../models/play/buildSession.js";
import { getPlaySubmissionModel } from "../../models/play/submission.js";
import {
  connectPlaySandbox,
  killPlaySandbox,
  snapshotProjectFiles,
} from "./sandbox.js";
import { assertNotStarterOnly } from "./starterDetection.js";
import { closeSessionTerminal } from "./terminal.js";
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
}): Promise<SubmitResult> {
  const anonymousId = input.anonymousId.trim();
  const displayName = input.displayName.trim();
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
  if (session.status !== "active") {
    throw createHttpError(400, `session_not_active:${session.status}`);
  }
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    session.status = "expired";
    await session.save();
    throw createHttpError(400, "session_expired");
  }
  if (!session.e2bSandboxId) {
    throw createHttpError(502, "session has no sandbox");
  }

  let sandbox: Sandbox;
  try {
    sandbox = await connectPlaySandbox(session.e2bSandboxId, {
      timeoutMs: 60 * 60 * 1000,
    });
  } catch {
    session.status = "expired";
    session.error = "Sandbox no longer reachable";
    await session.save();
    throw createHttpError(502, "Sandbox no longer reachable");
  }

  let snapshot;
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

  // Reject unchanged / near-empty starter before persisting or killing the sandbox
  assertNotStarterOnly(snapshot.files);

  const Submission = getPlaySubmissionModel();
  const submittedAt = new Date();
  const doc = await Submission.findOneAndUpdate(
    { anonymousId, challengeDate: session.challengeDate },
    {
      $set: {
        anonymousId,
        displayName,
        challengeSlug: session.challengeSlug,
        challengeDate: session.challengeDate,
        sessionId: session._id,
        files: snapshot.files,
        fileCount: snapshot.files.length,
        totalBytes: snapshot.totalBytes,
        submittedAt,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  session.status = "submitted";
  session.vscodeUrl = undefined;
  session.previewUrl = undefined;
  await session.save();

  await closeSessionTerminal(input.sessionId, { killPty: true });
  await killPlaySandbox(sandbox);

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
    files: (doc.files || []).map((f: { path: string; content: string }) => ({
      path: f.path,
      content: f.content,
    })),
  };
}
