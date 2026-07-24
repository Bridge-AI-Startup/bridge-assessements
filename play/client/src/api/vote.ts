import {
  get,
  getResponseErrorMessage,
  post,
  readJsonBody,
} from "@/api/requests";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";

export type RoundProgress = {
  votesInRound: number;
  roundSize: number;
  votesToday: number;
  maxVotes: number;
  roundIndex: number;
  remainingWeightedVotes: number;
};

export type VoteCard = {
  id: string;
  displayName: string;
  score: number;
  wins: number;
  losses: number;
  matches: number;
  provisional: boolean;
  previewRevision: string;
  files?: Array<{ path: string; content: string }>;
};

export type VoteNextResponse =
  | {
      pairAvailable: true;
      challengeDate: string;
      left: VoteCard;
      right: VoteCard;
      round: RoundProgress;
      canVote: true;
      pairsRemaining: number;
      allPairsComplete: false;
      canContinue: true;
    }
  | {
      pairAvailable: false;
      challengeDate: string;
      reason:
        | "must_submit"
        | "not_enough_submissions"
        | "no_pairs_left"
        | "vote_cap_reached";
      message: string;
      round: RoundProgress;
      canVote: boolean;
      pairsRemaining: number;
      allPairsComplete: boolean;
      canContinue: boolean;
    };

export type RoundRecapMovement = {
  id: string;
  displayName: string;
  beforeRank: number | null;
  afterRank: number | null;
  beforeScore: number | null;
  afterScore: number;
  deltaRank: number | null;
};

export type RoundRecap = {
  roundIndex: number;
  choices: Array<{
    winnerId: string;
    winnerName: string;
    loserId: string;
    loserName: string;
  }>;
  movements: RoundRecapMovement[];
  biggestMover: RoundRecapMovement | null;
};

export type CastVoteResponse = {
  recorded: true;
  challengeDate: string;
  round: RoundProgress;
  pairAvailable: boolean;
  left?: VoteCard;
  right?: VoteCard;
  recap?: RoundRecap;
  pairsRemaining: number;
  allPairsComplete: boolean;
  canContinue: boolean;
};

export type LeaderboardResponse = {
  challengeDate: string;
  entries: Array<{
    id: string;
    displayName: string;
    challengeSlug: string;
    challengeDate: string;
    score: number;
    wins: number;
    losses: number;
    matches: number;
    provisional: boolean;
    rank?: number;
    isMine?: boolean;
    submittedAt: string;
  }>;
  total: number;
  you: {
    id: string;
    displayName: string;
    score: number;
    wins: number;
    losses: number;
    matches: number;
    provisional: boolean;
    rank?: number;
    isMine?: boolean;
  } | null;
};

export async function fetchVoteNext(options: {
  anonymousId: string;
  challengeDate?: string;
  preferId?: string;
  includeFiles?: boolean;
}): Promise<VoteNextResponse> {
  const includeFiles = options.includeFiles ?? shouldFetchSubmissionFiles;
  const qs = new URLSearchParams({ anonymousId: options.anonymousId });
  if (options.challengeDate) qs.set("challengeDate", options.challengeDate);
  if (options.preferId) qs.set("preferId", options.preferId);
  qs.set("includeFiles", includeFiles ? "true" : "false");
  const res = await get(`/vote/next?${qs}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function castVote(body: {
  anonymousId: string;
  challengeDate?: string;
  winnerId: string;
  loserId: string;
  includeFiles?: boolean;
}): Promise<CastVoteResponse> {
  const payload = {
    ...body,
    includeFiles: body.includeFiles ?? shouldFetchSubmissionFiles,
  };
  const res = await post("/vote", payload);
  if (!res.ok) {
    const errorBody = await readJsonBody(res);
    throw new Error(getResponseErrorMessage(errorBody, res.status));
  }
  return res.json();
}

export async function fetchLeaderboard(options: {
  challengeDate?: string;
  limit?: number;
  anonymousId?: string;
} = {}): Promise<LeaderboardResponse> {
  const qs = new URLSearchParams();
  if (options.challengeDate) qs.set("challengeDate", options.challengeDate);
  if (options.limit) qs.set("limit", String(options.limit));
  if (options.anonymousId) qs.set("anonymousId", options.anonymousId);
  const res = await get(`/leaderboard?${qs}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
