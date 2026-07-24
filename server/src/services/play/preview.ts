import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlaySubmissionModel } from "../../models/play/submission.js";
import {
  filterPlayPublicFiles,
  PLAY_SNAPSHOT_SKIP_DIR_PATTERN,
} from "./sandbox.js";

const MAX_PREVIEW_PATH_LENGTH = 512;
const REVISION_PATTERN = /^\d{10,16}$/;

export type PlayPreviewFile = {
  path: string;
  content: string;
};

/**
 * Normalize a preview asset path for exact lookup against stored snapshot paths.
 * Empty → index.html. Rejects traversal, absolutes, secrets dirs, and overlong paths.
 */
export function normalizePlayPreviewPath(rawPath: string | null | undefined): string {
  let raw = rawPath == null ? "" : String(rawPath);
  if (raw.includes("\0")) {
    throw createHttpError(400, "invalid preview path");
  }
  raw = raw.replace(/\\/g, "/").trim();
  if (!raw || raw === "/") {
    return "index.html";
  }

  // Absolute paths (POSIX or Windows drive) are never allowed.
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw)) {
    throw createHttpError(400, "invalid preview path");
  }

  // Strip a single leading ./ only after confirming the path is relative.
  if (raw.startsWith("./")) {
    raw = raw.slice(2);
  }
  if (raw.startsWith("/")) {
    throw createHttpError(400, "invalid preview path");
  }

  if (!raw) {
    return "index.html";
  }

  if (raw.length > MAX_PREVIEW_PATH_LENGTH) {
    throw createHttpError(400, "invalid preview path");
  }

  const segments = raw.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw createHttpError(400, "invalid preview path");
    }
  }

  const normalized = segments.join("/");
  if (PLAY_SNAPSHOT_SKIP_DIR_PATTERN.test(normalized)) {
    throw createHttpError(400, "invalid preview path");
  }

  return normalized;
}

/** Immutable revision token: decimal epoch milliseconds of submittedAt. */
export function getPlayPreviewRevision(
  submittedAt: Date | string | number,
): string {
  const ms =
    submittedAt instanceof Date
      ? submittedAt.getTime()
      : typeof submittedAt === "number"
        ? submittedAt
        : /^\d{10,16}$/.test(String(submittedAt).trim())
          ? Number(String(submittedAt).trim())
          : new Date(submittedAt).getTime();

  if (!Number.isFinite(ms) || ms < 0) {
    throw createHttpError(400, "invalid preview revision");
  }
  const revision = String(Math.trunc(ms));
  if (!REVISION_PATTERN.test(revision)) {
    throw createHttpError(400, "invalid preview revision");
  }
  return revision;
}

function parseRevisionToDate(revision: string): Date {
  const trimmed = String(revision || "").trim();
  if (!REVISION_PATTERN.test(trimmed)) {
    throw createHttpError(400, "invalid preview revision");
  }
  const ms = Number(trimmed);
  if (!Number.isFinite(ms)) {
    throw createHttpError(400, "invalid preview revision");
  }
  return new Date(ms);
}

/**
 * Fetch exactly one stored snapshot file for a submission at an immutable revision.
 * Never transforms content — returns the stored string as-is.
 */
export async function getPlaySubmissionPreviewFile(input: {
  submissionId: string;
  revision: string;
  path?: string | null;
}): Promise<PlayPreviewFile> {
  const submissionId = String(input.submissionId || "").trim();
  if (!Types.ObjectId.isValid(submissionId)) {
    throw createHttpError(400, "invalid submission id");
  }

  const submittedAt = parseRevisionToDate(input.revision);
  const normalizedPath = normalizePlayPreviewPath(input.path);

  const Submission = getPlaySubmissionModel();
  const doc = (await Submission.findOne(
    {
      _id: new Types.ObjectId(submissionId),
      submittedAt,
      files: { $elemMatch: { path: normalizedPath } },
    },
    {
      submittedAt: 1,
      files: { $elemMatch: { path: normalizedPath } },
    },
  ).lean()) as {
    submittedAt?: Date;
    files?: Array<{ path: string; content: string }>;
  } | null;

  if (!doc) {
    throw createHttpError(404, "preview_not_found");
  }

  const publicFiles = filterPlayPublicFiles(doc.files || []);
  const file = publicFiles.find((f) => f.path === normalizedPath);
  if (!file || typeof file.content !== "string") {
    throw createHttpError(404, "preview_not_found");
  }

  return { path: file.path, content: file.content };
}
