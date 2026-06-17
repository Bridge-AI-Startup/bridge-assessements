import { describe, expect, it } from "vitest";

import type { EvaluationReport } from "../../../src/types/evaluation.js";
import {
  EXPECTED_CRITERIA,
  HIGH_MIN,
  LOW_MAX,
  bandMatches,
  compareEvaluation,
  computeTranscriptQuality,
  overallScore,
  scoreBand,
} from "../../video-eval/scoring.js";

function reportFromScores(scores: number[]): EvaluationReport {
  return {
    session_summary: "test",
    criteria_results: EXPECTED_CRITERIA.map((c, i) => ({
      criterion: c.criterion,
      score: scores[i],
      confidence: "high" as const,
      verdict: "v",
      evidence: [],
      evaluable: true,
    })),
  };
}

describe("scoreBand / bandMatches", () => {
  it("classifies high / low / mid by thresholds", () => {
    expect(scoreBand(HIGH_MIN)).toBe("high");
    expect(scoreBand(10)).toBe("high");
    expect(scoreBand(LOW_MAX)).toBe("low");
    expect(scoreBand(1)).toBe("low");
    expect(scoreBand(5)).toBe("mid");
  });

  it("bandMatches respects expectation", () => {
    expect(bandMatches(8, "high")).toBe(true);
    expect(bandMatches(2, "low")).toBe(true);
    expect(bandMatches(2, "high")).toBe(false);
    expect(bandMatches(5, "high")).toBe(false); // mid never matches
  });
});

describe("compareEvaluation", () => {
  it("passes when all produced bands match expectations", () => {
    // EXPECTED_CRITERIA = [high, high, low]
    const report = reportFromScores([9, 7, 2]);
    const cmp = compareEvaluation(report);
    expect(cmp.matched).toBe(3);
    expect(cmp.accuracy).toBe(1);
    expect(cmp.pass).toBe(true);
  });

  it("flags a mismatch when a 'low' criterion scores high", () => {
    const report = reportFromScores([9, 7, 8]); // last should be low but is high
    const cmp = compareEvaluation(report, EXPECTED_CRITERIA, 1);
    expect(cmp.matched).toBe(2);
    expect(cmp.pass).toBe(false);
    const aiRow = cmp.comparisons.find((c) => c.expected === "low");
    expect(aiRow?.match).toBe(false);
    expect(aiRow?.actualBand).toBe("high");
  });

  it("counts missing criteria as non-matches", () => {
    const report: EvaluationReport = {
      session_summary: "s",
      criteria_results: [],
    };
    const cmp = compareEvaluation(report);
    expect(cmp.matched).toBe(0);
    expect(cmp.comparisons.every((c) => c.match === false)).toBe(true);
    expect(cmp.comparisons.every((c) => c.actualScore === null)).toBe(true);
  });

  it("honors a fractional pass threshold", () => {
    const report = reportFromScores([9, 7, 8]); // 2/3 match
    expect(compareEvaluation(report, EXPECTED_CRITERIA, 2 / 3).pass).toBe(true);
    expect(compareEvaluation(report, EXPECTED_CRITERIA, 1).pass).toBe(false);
  });
});

describe("computeTranscriptQuality", () => {
  const jsonl = [
    JSON.stringify({ ts: "2026-01-01T00:00:00Z", region: "editor", text_content: "def is_prime(n):" }),
    JSON.stringify({ ts: "2026-01-01T00:00:05Z", region: "editor", text_content: "def primes_up_to(limit): return []" }),
    JSON.stringify({ ts: "2026-01-01T00:00:10Z", region: "terminal", text_content: "$ pytest -q -> 2 passed" }),
    JSON.stringify({ ts: "2026-01-01T00:00:15Z", region: "editor", text_content: "" }),
  ].join("\n");

  it("computes token recall case-insensitively", () => {
    const q = computeTranscriptQuality(jsonl, [
      "is_prime",
      "primes_up_to",
      "pytest",
      "passed",
      "def",
      "return",
    ]);
    expect(q.tokenRecall).toBe(1);
    expect(q.missingTokens).toEqual([]);
    expect(q.totalSegments).toBe(4);
    expect(q.nonEmptySegments).toBe(3);
  });

  it("reports missing tokens", () => {
    const q = computeTranscriptQuality(jsonl, ["is_prime", "kubernetes"]);
    expect(q.foundTokens).toContain("is_prime");
    expect(q.missingTokens).toContain("kubernetes");
    expect(q.tokenRecall).toBe(0.5);
  });

  it("handles empty transcript without throwing", () => {
    const q = computeTranscriptQuality("", ["x"]);
    expect(q.totalSegments).toBe(0);
    expect(q.tokenRecall).toBe(0);
  });

  it("tolerates code-fenced and malformed lines", () => {
    const messy = "```json\n" + JSON.stringify({ ts: "t", text_content: "is_prime" }) + "\n```\nnot json at all";
    const q = computeTranscriptQuality(messy, ["is_prime"]);
    expect(q.foundTokens).toContain("is_prime");
  });
});

describe("overallScore", () => {
  it("averages only evaluable criteria", () => {
    const report: EvaluationReport = {
      session_summary: "s",
      criteria_results: [
        { criterion: "a", score: 8, confidence: "high", verdict: "", evidence: [], evaluable: true },
        { criterion: "b", score: 6, confidence: "high", verdict: "", evidence: [], evaluable: true },
        { criterion: "c", score: 1, confidence: "low", verdict: "", evidence: [], evaluable: false },
      ],
    };
    expect(overallScore(report)).toBe(7);
  });

  it("returns null when nothing is evaluable", () => {
    const report: EvaluationReport = {
      session_summary: "s",
      criteria_results: [
        { criterion: "a", score: 1, confidence: "low", verdict: "", evidence: [], evaluable: false },
      ],
    };
    expect(overallScore(report)).toBeNull();
  });
});
