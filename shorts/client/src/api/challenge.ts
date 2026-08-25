import { get, getRequestErrorMessage } from "@/api/requests";

export type CurrentChallenge = {
  challengeDate: string;
  slug: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  category: string;
  makeMode?: "e2b" | "serverless";
  isActive?: boolean;
};

export type FetchCurrentRoundResult =
  | { status: "ok"; challenge: CurrentChallenge }
  | { status: "no_active_round" }
  | { status: "error"; message: string };

export async function fetchCurrentChallenge(): Promise<FetchCurrentRoundResult> {
  try {
    const res = await get("/round");
    if (res.status === 404) {
      return { status: "no_active_round" };
    }
    if (!res.ok) {
      return { status: "error", message: `HTTP ${res.status}` };
    }
    const challenge = (await res.json()) as CurrentChallenge;
    return { status: "ok", challenge };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}
