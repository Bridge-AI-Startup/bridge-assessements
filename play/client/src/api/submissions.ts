import { get } from "@/api/requests";

export type PublicSubmissionSummary = {
  id: string;
  displayName: string;
  challengeSlug: string;
  challengeDate: string;
  fileCount: number;
  totalBytes: number;
  submittedAt: string;
  score: number;
  wins: number;
  losses: number;
  matches: number;
  provisional: boolean;
  rank?: number;
  isMine?: boolean;
};

export type PublicSubmissionDetail = PublicSubmissionSummary & {
  files: Array<{ path: string; content: string }>;
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
  anonymousId?: string,
): Promise<PublicSubmissionDetail> {
  const qs = new URLSearchParams();
  if (anonymousId) qs.set("anonymousId", anonymousId);
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
