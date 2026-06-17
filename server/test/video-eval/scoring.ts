/**
 * Pure scoring + transcript-quality logic for the video-evaluation test.
 *
 * Kept free of any I/O so it can be unit-tested deterministically. The runner
 * feeds it the real evaluation report + transcript JSONL produced by the live
 * pipeline.
 */

import type {
  CriterionResult,
  EvaluationReport,
} from "../../src/types/evaluation.js";

export type ExpectedBand = "high" | "low";

export interface ExpectedCriterion {
  /** Criterion text passed to the evaluation pipeline. */
  criterion: string;
  /**
   * Expected band given how the fixture was authored:
   *  - "high": the behavior is clearly present in the video (expect score >= HIGH_MIN)
   *  - "low":  the behavior is clearly absent (expect score <= LOW_MAX)
   */
  expected: ExpectedBand;
  /** Why we expect this band — surfaced in the report. */
  rationale: string;
}

export const HIGH_MIN = 6; // score >= 6 counts as "high"
export const LOW_MAX = 4; // score <= 4 counts as "low"

/**
 * Criteria for the prime-numbers coding screencast. Two are clearly present
 * (incremental coding, running tests) and one is clearly absent (AI assistant),
 * giving an objective ground truth to compare produced scores against.
 */
export const EXPECTED_CRITERIA: ExpectedCriterion[] = [
  {
    criterion:
      "The candidate builds their solution incrementally, writing and refining code step by step rather than pasting a finished solution.",
    expected: "high",
    rationale:
      "The screencast shows code being typed line by line across many frames (is_prime, then primes_up_to, then tests).",
  },
  {
    criterion:
      "The candidate tests their own code by writing and running tests in a terminal.",
    expected: "high",
    rationale:
      "The terminal runs pytest, surfaces a failing test, the candidate fixes the bug, and re-runs to green.",
  },
  {
    criterion:
      "The candidate relied on an AI coding assistant (e.g. Cursor, Copilot, ChatGPT) to generate the solution.",
    expected: "low",
    rationale:
      "There is no AI chat panel or assistant interaction anywhere in the recording.",
  },
];

export function scoreBand(score: number): ExpectedBand | "mid" {
  if (score >= HIGH_MIN) return "high";
  if (score <= LOW_MAX) return "low";
  return "mid";
}

export function bandMatches(score: number, expected: ExpectedBand): boolean {
  return scoreBand(score) === expected;
}

export interface CriterionComparison {
  criterion: string;
  expected: ExpectedBand;
  rationale: string;
  actualScore: number | null;
  actualBand: ExpectedBand | "mid" | null;
  confidence: string | null;
  evaluable: boolean | null;
  verdict: string | null;
  match: boolean;
}

export interface EvaluationComparison {
  comparisons: CriterionComparison[];
  matched: number;
  total: number;
  accuracy: number; // 0..1
  pass: boolean; // true if accuracy >= passThreshold
}

/**
 * Compare a produced evaluation report against the expected bands.
 * Matches by criterion text; missing criteria count as non-matches.
 */
export function compareEvaluation(
  report: EvaluationReport,
  expected: ExpectedCriterion[] = EXPECTED_CRITERIA,
  passThreshold = 1 // require all bands to match by default
): EvaluationComparison {
  const byCriterion = new Map<string, CriterionResult>();
  for (const r of report.criteria_results) byCriterion.set(r.criterion, r);

  const comparisons: CriterionComparison[] = expected.map((exp) => {
    const r = byCriterion.get(exp.criterion);
    if (!r) {
      return {
        criterion: exp.criterion,
        expected: exp.expected,
        rationale: exp.rationale,
        actualScore: null,
        actualBand: null,
        confidence: null,
        evaluable: null,
        verdict: null,
        match: false,
      };
    }
    const actualBand = scoreBand(r.score);
    return {
      criterion: exp.criterion,
      expected: exp.expected,
      rationale: exp.rationale,
      actualScore: r.score,
      actualBand,
      confidence: r.confidence,
      evaluable: r.evaluable,
      verdict: r.verdict,
      match: actualBand === exp.expected,
    };
  });

  const matched = comparisons.filter((c) => c.match).length;
  const total = comparisons.length;
  const accuracy = total === 0 ? 0 : matched / total;
  return {
    comparisons,
    matched,
    total,
    accuracy,
    pass: accuracy >= passThreshold,
  };
}

export interface TranscriptQuality {
  totalSegments: number;
  nonEmptySegments: number;
  nonEmptyRatio: number;
  totalChars: number;
  expectedTokens: string[];
  foundTokens: string[];
  missingTokens: string[];
  tokenRecall: number; // 0..1
}

/**
 * Measure how faithfully the transcript captured the on-screen content.
 * `tokenRecall` = fraction of expected code tokens that appear (case-insensitive)
 * anywhere in the transcript text — a proxy for OCR/transcription quality.
 */
export function computeTranscriptQuality(
  jsonl: string,
  expectedTokens: string[]
): TranscriptQuality {
  const lines = jsonl.split("\n").map((l) => l.trim()).filter(Boolean);
  let nonEmpty = 0;
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const cleaned = line
        .replace(/^```(?:json|jsonl)?/, "")
        .replace(/```$/, "")
        .trim();
      if (!cleaned) continue;
      const obj = JSON.parse(cleaned);
      const text: string =
        (obj.text_content ?? obj.description ?? "").toString();
      if (text.trim().length > 0) {
        nonEmpty++;
        texts.push(text);
      }
    } catch {
      // Non-JSON line: still counts toward raw text for token recall.
      texts.push(line);
    }
  }

  const haystack = texts.join("\n").toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];
  for (const tok of expectedTokens) {
    if (haystack.includes(tok.toLowerCase())) found.push(tok);
    else missing.push(tok);
  }

  const totalSegments = lines.length;
  return {
    totalSegments,
    nonEmptySegments: nonEmpty,
    nonEmptyRatio: totalSegments === 0 ? 0 : nonEmpty / totalSegments,
    totalChars: haystack.length,
    expectedTokens,
    foundTokens: found,
    missingTokens: missing,
    tokenRecall:
      expectedTokens.length === 0 ? 0 : found.length / expectedTokens.length,
  };
}

/** Average score over evaluable criteria (mirrors the app's aggregate helper). */
export function overallScore(report: EvaluationReport): number | null {
  const evaluable = report.criteria_results.filter((r) => r.evaluable);
  if (evaluable.length === 0) return null;
  const sum = evaluable.reduce((s, r) => s + r.score, 0);
  return Math.round((sum / evaluable.length) * 10) / 10;
}
