import {
  authDelete,
  authGet,
  authPost,
  getResponseErrorMessage,
  readJsonBody,
} from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import type { PublicSubmissionSummary } from "@/api/submissions";

/**
 * Stars are private bookmarks. Guest tier works off this browser's
 * anonymousId; the auth'd helpers attach a Firebase token when signed in so
 * saved lists follow the account across linked devices (server-side union,
 * same as submissions).
 */

export async function setStarred(
  submissionId: string,
  starred: boolean,
): Promise<{ starred: boolean }> {
  const anonymousId = getOrCreateAnonymousId();
  const res = starred
    ? await authPost(`/submissions/${submissionId}/star`, { anonymousId })
    : await authDelete(`/submissions/${submissionId}/star`, { anonymousId });
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new Error(getResponseErrorMessage(body, res.status));
  }
  return body as { starred: boolean };
}

/** Cheap membership read for painting filled stars on gallery cards. */
export async function fetchStarredIds(): Promise<Set<string>> {
  const anonymousId = getOrCreateAnonymousId();
  const res = await authGet(
    `/stars?anonymousId=${encodeURIComponent(anonymousId)}&idsOnly=true`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ids?: string[] };
  return new Set(body.ids || []);
}

/** The full saved list, newest star first, with gallery-card summaries. */
export async function fetchSavedBuilds(): Promise<{
  ids: string[];
  submissions: PublicSubmissionSummary[];
}> {
  const anonymousId = getOrCreateAnonymousId();
  const res = await authGet(
    `/stars?anonymousId=${encodeURIComponent(anonymousId)}`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    ids?: string[];
    submissions?: PublicSubmissionSummary[];
  };
  return { ids: body.ids || [], submissions: body.submissions || [] };
}
