/** Shared TrueSkill defaults (safe for models + services). */
export const INITIAL_RATING_MEAN = 25;
export const INITIAL_RATING_DEVIATION = 25 / 3;

export function rankingScoreFrom(mean: number, deviation: number): number {
  return mean - 3 * deviation;
}

export const INITIAL_RANKING_SCORE = rankingScoreFrom(
  INITIAL_RATING_MEAN,
  INITIAL_RATING_DEVIATION,
);

export const PROVISIONAL_MATCH_THRESHOLD = 5;
export const VOTE_ROUND_SIZE = 5;
export const MAX_WEIGHTED_VOTES_PER_DAY = 25;
