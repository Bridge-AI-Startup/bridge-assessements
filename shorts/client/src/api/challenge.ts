import { get, getRequestErrorMessage } from "@/api/requests";

export type TodayChallenge = {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  timeLimitMinutes?: number;
  category: string;
  makeMode?: "e2b" | "serverless";
  cadence?: "daily" | "weekly";
  periodEndsAt?: string;
};

export type FetchTodayResult =
  | { status: "ok"; challenge: TodayChallenge }
  | { status: "no_challenge_today" }
  | { status: "error"; message: string };

export async function fetchTodayChallenge(): Promise<FetchTodayResult> {
  try {
    const res = await get("/today");
    if (res.status === 404) {
      return { status: "no_challenge_today" };
    }
    if (!res.ok) {
      return { status: "error", message: `HTTP ${res.status}` };
    }
    const challenge = (await res.json()) as TodayChallenge;
    return { status: "ok", challenge };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}
