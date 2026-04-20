/**
 * Public leaderboard score — must stay in sync with client `SubmissionsDashboard.jsx`:
 * `getCombinedScore0to100` + `getCombinedScoreBreakdownParts`.
 *
 * Mean of available signals (0–100 each): screen/recording rubric, behavioral pass rate,
 * trace workflow (`scores.overall` only — same as employer UI, not llmWorkflow nested alone).
 */

type SubmissionLike = {
  scores?: {
    overall?: number | null;
    completeness?: { score?: number | null };
  } | null;
  behavioralGradingStatus?: string | null;
  behavioralGradingReport?: { cases?: Array<{ verdict?: string }> } | null;
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
  const cases = sub.behavioralGradingReport?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return null;
  let pts = 0;
  for (const c of cases) {
    if (c.verdict === "pass") pts += 1;
    else if (c.verdict === "inconclusive") pts += 0.5;
  }
  return (pts / cases.length) * 100;
}

/** Trace / workflow — employer dashboard only uses top-level `scores.overall`. */
function getLlmWorkflow0to100(sub: SubmissionLike): number | null {
  const o = sub.scores?.overall;
  if (typeof o === "number" && !Number.isNaN(o)) return o;
  return null;
}

/**
 * Combined 0–100 score: average of whichever of (recording rubric, behavioral, workflow) exist.
 * Returns null if none of the signals are available.
 */
export function getCombinedLeaderboardScore(sub: SubmissionLike): number | null {
  const parts = [
    getRecordingRubric0to100(sub),
    getBehavioralPass0to100(sub),
    getLlmWorkflow0to100(sub),
  ].filter((v): v is number => v != null && !Number.isNaN(v));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Same strings as employer submission panel under “Combined score”. */
export function getCombinedScoreBreakdownParts(sub: SubmissionLike): string[] {
  const segs: string[] = [];
  const rec = getRecordingRubric0to100(sub);
  const beh = getBehavioralPass0to100(sub);
  const wf = getLlmWorkflow0to100(sub);
  if (rec != null) segs.push(`Screen ${(rec / 10).toFixed(1)}/10`);
  if (beh != null) segs.push(`Behavioral ${Math.round(beh)}%`);
  if (wf != null) segs.push(`Trace ${Math.round(wf)}`);
  return segs;
}
