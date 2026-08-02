import { get } from "@/api/requests";

export type PastChallengeSummary = {
  slug: string;
  title: string;
  challengeDate: string;
  category: string;
  submissionCount: number;
  isCurrent: boolean;
};

/** Published challenges up to the current period, newest first. */
export async function listPastChallenges(options: { limit?: number } = {}): Promise<{
  challenges: PastChallengeSummary[];
  total: number;
}> {
  const qs = new URLSearchParams();
  if (options.limit) qs.set("limit", String(options.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await get(`/challenges${suffix}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
