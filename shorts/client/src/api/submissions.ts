import {
  authDelete,
  authGet,
  get,
  getResponseErrorMessage,
  readJsonBody,
} from "@/api/requests";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";

export type PublicSubmissionSummary = {
  id: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: string;
  previewRevision: string;
  score: number;
  wins: number;
  losses: number;
  matches: number;
  provisional: boolean;
  rank?: number;
  isMine?: boolean;
};

export type PublicSubmissionDetail = PublicSubmissionSummary & {
  files?: Array<{ path: string; content: string }>;
};

export async function listSubmissions(options: {
  challengeDate?: string;
  limit?: number;
  anonymousId?: string;
} = {}): Promise<{
  challengeDate: string;
  submissions: PublicSubmissionSummary[];
  total: number;
  /** Every entry belonging to `anonymousId`, regardless of `limit`. */
  mine: PublicSubmissionSummary[];
}> {
  const qs = new URLSearchParams();
  if (options.challengeDate) qs.set("challengeDate", options.challengeDate);
  if (options.limit) qs.set("limit", String(options.limit));
  if (options.anonymousId) qs.set("anonymousId", options.anonymousId);
  const res = await get(`/submissions?${qs}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function getSubmission(
  id: string,
  options:
    | string
    | {
        anonymousId?: string;
        includeFiles?: boolean;
      } = {},
): Promise<PublicSubmissionDetail> {
  // Backward-compatible: second arg used to be anonymousId string.
  const normalized =
    typeof options === "string"
      ? { anonymousId: options }
      : options || {};
  const includeFiles =
    normalized.includeFiles ?? shouldFetchSubmissionFiles;
  const qs = new URLSearchParams();
  if (normalized.anonymousId) qs.set("anonymousId", normalized.anonymousId);
  qs.set("includeFiles", includeFiles ? "true" : "false");
  const suffix = qs.toString() ? `?${qs}` : "";
  // authGet attaches a Firebase token when signed in so `isMine` also covers
  // builds stamped with that account (another device, cleared storage).
  const res = await authGet(`/submissions/${id}${suffix}`);
  if (res.status === 404) {
    throw new Error("not_found");
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export type DeleteOwnSubmissionResult = {
  deleted: true;
  id: string;
  displayName: string;
  challengeDate: string;
  votesRemoved: number;
};

/** Remove one of the caller's builds. Guest = this browser; signed-in = account. */
export async function deleteOwnSubmission(
  id: string,
): Promise<DeleteOwnSubmissionResult> {
  const anonymousId = getOrCreateAnonymousId();
  const res = await authDelete(`/submissions/${id}`, { anonymousId });
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new Error(getResponseErrorMessage(body, res.status));
  }
  return body as DeleteOwnSubmissionResult;
}

export type RenameOwnSubmissionResult = {
  renamed: true;
  id: string;
  displayName: string;
  challengeDate: string;
};

/** Rename one of the caller's builds. Same ownership rules as delete. */
export async function renameOwnSubmission(
  id: string,
  displayName: string,
): Promise<RenameOwnSubmissionResult> {
  const anonymousId = getOrCreateAnonymousId();
  const res = await authPatch(`/submissions/${id}`, {
    anonymousId,
    displayName: displayName.trim(),
  });
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new Error(getResponseErrorMessage(body, res.status));
  }
  return body as RenameOwnSubmissionResult;
}
