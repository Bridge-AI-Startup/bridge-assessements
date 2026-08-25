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
  votesThisRound: number;
  /** @deprecated Compatibility with older servers during rollout. */
  votesToday?: number;
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
      /** False when the player hasn't submitted — their picks don't rank. */
      weighted: boolean;
      pairsRemaining: number;
      allPairsComplete: false;
      canContinue: true;
    }
  | {
      pairAvailable: false;
      challengeDate: string;
      reason:
        // Retired server-side (anyone may play now); kept for compatibility.
        | "must_submit"
        | "not_enough_submissions"
        | "no_pairs_left"
        // Retired: voting stops on unique pairs, not a count budget.
        | "vote_cap_reached";
      message: string;
      round: RoundProgress;
      canVote: boolean;
      weighted: boolean;
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
  /** False when the player hasn't submitted — the vote is stored but inert. */
  weighted: boolean;
  /** This pick closed a five-pick round. Unweighted rounds carry no recap. */
  roundComplete: boolean;
  pairsRemaining: number;
  allPairsComplete: boolean;
  canContinue: boolean;
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
