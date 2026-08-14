import { describe, expect, it } from "vitest";

import {
  MIN_DECIDED_COVERAGE,
  computeBehavioralScore,
  resolveBehavioralScore,
} from "../../src/services/behavioralGrading/scoring.js";
import { checkRequiresRunningApp } from "../../src/services/behavioralGrading/setupHealth.js";
import {
  getCombinedLeaderboardScore,
  getCombinedScoreBreakdownParts,
} from "../../src/utils/leaderboardScore.js";

const cases = (...verdicts: string[]) => verdicts.map((verdict) => ({ verdict }));

describe("computeBehavioralScore", () => {
  it("scores a fully decided run over every check", () => {
    const score = computeBehavioralScore(cases("pass", "pass", "pass", "fail"));
    expect(score.total).toBe(4);
    expect(score.decided).toBe(4);
    expect(score.passed).toBe(3);
    expect(score.failed).toBe(1);
    expect(score.coverage).toBe(1);
    expect(score.passRate).toBe(75);
  });

  it("drops undecided checks out of the denominator instead of half-crediting them", () => {
    // 3 pass, 1 fail, 2 undecided. Half credit would read 58%; the honest figure
    // is 75% of what was actually decided.
    const score = computeBehavioralScore(
      cases("pass", "pass", "pass", "fail", "inconclusive", "blocked")
    );
    expect(score.decided).toBe(4);
    expect(score.inconclusive).toBe(1);
    expect(score.blocked).toBe(1);
    expect(score.passRate).toBe(75);
  });

  it("publishes no number when fewer than half the checks were decided", () => {
    const score = computeBehavioralScore(
      cases("pass", "pass", "inconclusive", "blocked", "blocked", "blocked")
    );
    expect(score.decided).toBe(2);
    expect(score.coverage).toBeCloseTo(1 / 3);
    expect(score.coverage).toBeLessThan(MIN_DECIDED_COVERAGE);
    expect(score.passRate).toBeNull();
  });

  it("publishes at exactly the coverage floor", () => {
    const score = computeBehavioralScore(
      cases("pass", "fail", "inconclusive", "blocked")
    );
    expect(score.coverage).toBe(MIN_DECIDED_COVERAGE);
    expect(score.passRate).toBe(50);
  });

  it("gives a project that never booted no score at all rather than 50%", () => {
    const score = computeBehavioralScore(
      cases("blocked", "blocked", "blocked", "blocked", "blocked")
    );
    expect(score.blocked).toBe(5);
    expect(score.decided).toBe(0);
    expect(score.passRate).toBeNull();
  });

  it("scores an all-fail run as 0, not as unscored", () => {
    const score = computeBehavioralScore(cases("fail", "fail", "fail"));
    expect(score.decided).toBe(3);
    expect(score.passRate).toBe(0);
  });

  it("treats an empty or missing case list as nothing verified", () => {
    for (const input of [[], null, undefined]) {
      const score = computeBehavioralScore(input);
      expect(score.total).toBe(0);
      expect(score.passRate).toBeNull();
    }
  });

  it("counts an unrecognized verdict as undecided rather than as a fail", () => {
    const score = computeBehavioralScore(cases("pass", "weird", "pass"));
    expect(score.inconclusive).toBe(1);
    expect(score.decided).toBe(2);
    expect(score.passRate).toBe(100);
  });
});

describe("resolveBehavioralScore", () => {
  it("prefers the score the server stored", () => {
    const stored = computeBehavioralScore(cases("pass", "pass"));
    const score = resolveBehavioralScore({
      score: stored,
      cases: cases("fail", "fail"),
    });
    expect(score.passRate).toBe(100);
  });

  it("derives today's rules for a legacy report with no stored score", () => {
    const score = resolveBehavioralScore({
      cases: cases("pass", "fail", "inconclusive", "inconclusive"),
    });
    expect(score.decided).toBe(2);
    expect(score.passRate).toBe(50);
  });

  it("ignores a malformed stored score", () => {
    const score = resolveBehavioralScore({
      score: { passRate: 99 } as never,
      cases: cases("pass", "fail"),
    });
    expect(score.passRate).toBe(50);
  });
});

describe("checkRequiresRunningApp", () => {
  it("treats observable product behavior as needing a running app", () => {
    for (const check of [
      "Someone can add a note.",
      "The list of notes is shown after signing in.",
      "Submitting an empty form shows an error message.",
    ]) {
      expect(checkRequiresRunningApp(check)).toBe(true);
    }
  });

  it("lets source-level checks still be judged from the clone", () => {
    for (const check of [
      "The README explains how to run the project.",
      "The repository contains tests for the pricing rules.",
      "The source code separates routing from business logic.",
    ]) {
      expect(checkRequiresRunningApp(check)).toBe(false);
    }
  });

  it("does not crash on empty input", () => {
    expect(checkRequiresRunningApp("")).toBe(true);
  });
});

describe("combined leaderboard score", () => {
  const rubric = {
    criteria_results: [
      { evaluable: true, score: 8 },
      { evaluable: true, score: 6 },
    ],
  };

  it("averages the screen rubric with the behavioral pass rate", () => {
    const combined = getCombinedLeaderboardScore({
      behavioralGradingStatus: "completed",
      behavioralGradingReport: {
        cases: cases("pass", "pass", "pass", "fail"),
        score: computeBehavioralScore(cases("pass", "pass", "pass", "fail")),
      },
      evaluationReport: rubric,
    });
    // Screen 70, behavioral 75.
    expect(combined).toBe(72.5);
  });

  it("leaves an unscorable behavioral run out of the average entirely", () => {
    const unscorable = computeBehavioralScore(
      cases("pass", "blocked", "blocked", "blocked")
    );
    const combined = getCombinedLeaderboardScore({
      behavioralGradingStatus: "completed",
      behavioralGradingReport: { cases: cases("pass", "blocked", "blocked", "blocked"), score: unscorable },
      evaluationReport: rubric,
    });
    expect(combined).toBe(70);
  });

  it("says how many checks a partial pass rate covers", () => {
    const parts = getCombinedScoreBreakdownParts({
      behavioralGradingStatus: "completed",
      behavioralGradingReport: {
        cases: cases("pass", "pass", "fail", "blocked"),
        score: computeBehavioralScore(cases("pass", "pass", "fail", "blocked")),
      },
      evaluationReport: rubric,
    });
    expect(parts).toEqual(["Process 7.0/10", "Behavioral 67% (3/4 checks decided)"]);
  });

  it("omits the coverage note when every check was decided", () => {
    const parts = getCombinedScoreBreakdownParts({
      behavioralGradingStatus: "completed",
      behavioralGradingReport: {
        cases: cases("pass", "fail"),
        score: computeBehavioralScore(cases("pass", "fail")),
      },
    });
    expect(parts).toEqual(["Behavioral 50%"]);
  });

  it("still refuses to score a legacy setup-failure report", () => {
    const combined = getCombinedLeaderboardScore({
      behavioralGradingStatus: "completed",
      behavioralGradingReport: {
        failureCategory: "setup",
        cases: cases("inconclusive", "inconclusive", "pass"),
      },
      evaluationReport: rubric,
    });
    expect(combined).toBe(70);
  });
});
