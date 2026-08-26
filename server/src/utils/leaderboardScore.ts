/**
 * Public leaderboard score — must stay in sync with client `SubmissionsDashboard.jsx`:
 * `getCombinedScore0to100` + `getCombinedScoreBreakdownParts`.
 *
 * Mean of available signals (0–100 each): process rubric and code-grading pass rate.
 *
 * The code-grading half is not derived here — it comes from the score stored on the
 * report by `behavioralGrading/scoring.ts`, so the leaderboard, the dashboard and
 * the report itself cannot disagree about what a candidate scored.
 */

import {
  resolveBehavioralScore,
  type BehavioralScore,
} from "../services/behavioralGrading/scoring.js";

type SubmissionLike = {
  behavioralGradingStatus?: string | null;
  behavioralGradingReport?: {
    cases?: Array<{ verdict?: string }>;
    score?: BehavioralScore | null;
    failureCategory?: string | null;
  } | null;
  evaluationReport?: {
    criteria_results?: Array<{ evaluable?: boolean; score?: number }>;
  } | null;
};

function getRecordingRubric0to100(sub: SubmissionLike): number | null {
  const results = sub.evaluationReport?.criteria_results;
  if (!Array.isArray(results)) return null;
  const evaluable = results.filter((r) => r.evaluable);
  if (evaluable.length === 0) return null;
  let sum = 0;
  for (const r of evaluable) {
    if (typeof r.score === "number" && !Number.isNaN(r.score)) sum += r.score;
  }
  return (sum / evaluable.length) * 10;
}

function getBehavioralPass0to100(sub: SubmissionLike): number | null {
  if (sub.behavioralGradingStatus !== "completed") return null;
  // Setup failure = grading environment problem, not candidate performance. New
  // runs report those checks as blocked and score null on their own; this still
  // guards legacy reports whose cases hold inconclusive verdicts instead.
  if (sub.behavioralGradingReport?.failureCategory === "setup") return null;
  return resolveBehavioralScore(sub.behavioralGradingReport).passRate;
}

/**
 * Combined 0–100 score: average of whichever of (process rubric, code grading) exist.
 * Returns null if none of the signals are available.
 */
export function getCombinedLeaderboardScore(sub: SubmissionLike): number | null {
  const parts = [
    getRecordingRubric0to100(sub),
    getBehavioralPass0to100(sub),
  ].filter((v): v is number => v != null && !Number.isNaN(v));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Same strings as employer submission panel under “Combined score”. */
export function getCombinedScoreBreakdownParts(sub: SubmissionLike): string[] {
  const segs: string[] = [];
  const rec = getRecordingRubric0to100(sub);
  const beh = getBehavioralPass0to100(sub);
  if (rec != null) segs.push(`Process ${(rec / 10).toFixed(1)}/10`);
  if (beh != null) {
    const score = resolveBehavioralScore(sub.behavioralGradingReport);
    // Say how much of the assessment the percentage actually covers, so a rate
    // over 4 of 6 checks is never mistaken for a rate over all 6.
    const coverage =
      score.decided > 0 && score.decided < score.total
        ? ` (${score.decided}/${score.total} checks decided)`
        : "";
    segs.push(`Code ${Math.round(beh)}%${coverage}`);
  }
  return segs;
}
