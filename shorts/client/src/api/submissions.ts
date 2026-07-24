import { get } from "@/api/requests";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";

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
  const res = await get(`/submissions/${id}${suffix}`);
  if (res.status === 404) {
    throw new Error("not_found");
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
