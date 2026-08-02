import { authGet, authPost } from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import type { PublicSubmissionSummary } from "@/api/submissions";

export type AccountSubmissionEntry = PublicSubmissionSummary & {
  challengeTitle: string;
};

/**
 * Claim this browser's anonymous id for the signed-in account. Idempotent;
 * call after every successful sign-in so each device gets linked.
 */
export async function linkCurrentAnonymousId(): Promise<{
  linked: boolean;
  linkedIds: number;
}> {
  const anonymousId = getOrCreateAnonymousId();
  const res = await authPost("/account/link", { anonymousId });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** Every submission across all anonymous ids linked to the account. */
export async function fetchMySubmissions(): Promise<{
  submissions: AccountSubmissionEntry[];
  linkedIds: number;
}> {
  const res = await authGet("/account/submissions");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
