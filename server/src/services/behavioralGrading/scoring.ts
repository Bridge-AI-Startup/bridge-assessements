/**
 * The one place a behavioral grading report becomes a number.
 *
 * Two rules make the result defensible to a candidate who asks how they were
 * scored:
 *
 *  1. **Undecided checks leave the denominator.** `inconclusive` and `blocked`
 *     are not partial credit. Awarding half a mark for "we could not tell" let a
 *     project that never booted score 50%, which is neither a pass the candidate
 *     earned nor a fail they deserve.
 *  2. **Thin coverage publishes no number at all.** If fewer than half the
 *     checks were decided, `passRate` is null: the honest answer is "not enough
 *     was verified", not a percentage derived from two of six checks.
 *
 * Computed once at report assembly and stored on the report, so the server
 * leaderboard and the employer dashboard read the same figure instead of each
 * deriving their own.
 */

export type BehavioralVerdict = "pass" | "fail" | "inconclusive" | "blocked";

export type BehavioralScore = {
  total: number;
  /** pass + fail — the checks grading actually settled. */
  decided: number;
  passed: number;
  failed: number;
  /** Judge could not reach a conclusion (ambiguous evidence, or it ran out of turns). */
  inconclusive: number;
  /** Never judged because the environment could not support it. */
  blocked: number;
  /** decided / total, 0..1. */
  coverage: number;
  /** passed / decided as 0–100, or null when coverage is below the floor. */
  passRate: number | null;
};

/** Below this share of decided checks, the run does not produce a score. */
export const MIN_DECIDED_COVERAGE = 0.5;

type CaseLike = { verdict?: string | null };

export function computeBehavioralScore(
  cases: CaseLike[] | null | undefined
): BehavioralScore {
  const list = Array.isArray(cases) ? cases : [];
  let passed = 0;
  let failed = 0;
  let inconclusive = 0;
  let blocked = 0;

  for (const c of list) {
    switch (c?.verdict) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
      default:
        // Anything that is not an explicit pass/fail/blocked (including a legacy
        // or malformed verdict) counts as undecided rather than silently as 0.
        inconclusive += 1;
        break;
    }
  }

  const total = list.length;
  const decided = passed + failed;
  const coverage = total === 0 ? 0 : decided / total;
  const publishable = total > 0 && decided > 0 && coverage >= MIN_DECIDED_COVERAGE;

  return {
    total,
    decided,
    passed,
    failed,
    inconclusive,
    blocked,
    coverage,
    passRate: publishable ? (passed / decided) * 100 : null,
  };
}

type ReportLike = {
  score?: BehavioralScore | null;
  cases?: CaseLike[] | null;
};

/**
 * Read the stored score, falling back to deriving it for reports written before
 * `score` existed. Callers get today's rules either way.
 */
export function resolveBehavioralScore(
  report: ReportLike | null | undefined
): BehavioralScore {
  const stored = report?.score;
  if (stored && typeof stored.total === "number" && typeof stored.decided === "number") {
    return stored;
  }
  return computeBehavioralScore(report?.cases);
}
