/**
 * Simplified TrueSkill-style 1v1 Gaussian rating updates for Play pairwise votes.
 * Public display uses a normalized score; ranking uses conservative μ − 3σ.
 */

import {
  INITIAL_RATING_DEVIATION,
  INITIAL_RATING_MEAN,
  PROVISIONAL_MATCH_THRESHOLD,
  rankingScoreFrom,
} from "./ratingConstants.js";

export {
  INITIAL_RATING_DEVIATION,
  INITIAL_RATING_MEAN,
  INITIAL_RANKING_SCORE,
  PROVISIONAL_MATCH_THRESHOLD,
  rankingScoreFrom,
  VOTE_ROUND_SIZE,
} from "./ratingConstants.js";

/** Performance variance parameter (β). */
const BETA = INITIAL_RATING_DEVIATION / 2;
/** Dynamics factor (τ) — slight inflation of σ so old ratings don't freeze. */
const TAU = INITIAL_RATING_DEVIATION / 100;

export type RatingState = {
  ratingMean: number;
  ratingDeviation: number;
};

/** Friendly public score (~1000 starting). */
export function publicScoreFrom(rankingScore: number): number {
  return Math.round(1000 + rankingScore * 40);
}

export function isProvisional(matches: number): boolean {
  return matches < PROVISIONAL_MATCH_THRESHOLD;
}

function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via erf approximation. */
function cdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz and Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function vWin(t: number): number {
  const denom = cdf(t);
  if (denom < 1e-12) return 0;
  return pdf(t) / denom;
}

function wWin(t: number, v: number): number {
  return v * (v + t);
}

/**
 * Apply a decisive 1v1 update (winner beats loser).
 * Returns new rating states for both players.
 */
export function updateRatings1v1(
  winner: RatingState,
  loser: RatingState,
): { winner: RatingState; loser: RatingState } {
  const sigmaW = Math.sqrt(winner.ratingDeviation ** 2 + TAU ** 2);
  const sigmaL = Math.sqrt(loser.ratingDeviation ** 2 + TAU ** 2);

  const c2 = 2 * BETA * BETA + sigmaW * sigmaW + sigmaL * sigmaL;
  const c = Math.sqrt(c2);
  const t = (winner.ratingMean - loser.ratingMean) / c;

  const v = vWin(t);
  const w = wWin(t, v);

  const muW = winner.ratingMean + ((sigmaW * sigmaW) / c) * v;
  const muL = loser.ratingMean - ((sigmaL * sigmaL) / c) * v;

  const sigmaW2 =
    sigmaW * sigmaW * (1 - ((sigmaW * sigmaW) / c2) * w);
  const sigmaL2 =
    sigmaL * sigmaL * (1 - ((sigmaL * sigmaL) / c2) * w);

  return {
    winner: {
      ratingMean: muW,
      ratingDeviation: Math.sqrt(Math.max(sigmaW2, 1e-4)),
    },
    loser: {
      ratingMean: muL,
      ratingDeviation: Math.sqrt(Math.max(sigmaL2, 1e-4)),
    },
  };
}

export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Information value heuristic for matchmaking (higher = more useful pair). */
export function pairInformationValue(
  a: RatingState & { matches: number },
  b: RatingState & { matches: number },
): number {
  const meanDiff = Math.abs(a.ratingMean - b.ratingMean);
  const uncertainty = a.ratingDeviation + b.ratingDeviation;
  const exposureNeed =
    1 / (1 + Math.min(a.matches, b.matches)) +
    (isProvisional(a.matches) ? 0.5 : 0) +
    (isProvisional(b.matches) ? 0.5 : 0);
  // Prefer similar means + high combined uncertainty + low exposure.
  return exposureNeed * 2 + uncertainty - meanDiff * 0.15;
}
