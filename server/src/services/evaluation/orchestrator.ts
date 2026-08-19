import { validateCriterion } from "./validator.js";
import { groundCriterion } from "./grounder.js";
import { retrieveRelevantEvents } from "./retriever.js";
import { evaluateCriterionWithGrounding } from "./evaluator.js";
import { generateSessionSummary } from "./sessionSummary.js";
import type {
  TranscriptEvent,
  EvaluationReport,
  CriterionResult,
  GroundedCriterion,
} from "../../types/evaluation.js";

export type EvaluateTranscriptOptions = {
  /** Pre-grounded criteria from assessment (same order as criteria). When present, ground step is skipped. */
  groundings?: GroundedCriterion[];
  /**
   * Persisted evaluability verdicts (same order as criteria), from
   * `ensureCriteriaValidations`. When present, the per-run LLM validation is
   * skipped — evaluability is decided once per criterion, not once per
   * candidate, so the same criterion cannot grade for one submission and
   * refuse for the next.
   */
  validations?: Array<{ valid: boolean; reason?: string | null }>;
};

/**
 * Run the full evaluation pipeline: validate → ground (or use provided groundings) → retrieve → evaluate
 * per criterion, plus a session summary. All criteria are processed in parallel;
 * session summary runs in parallel with them.
 */
export async function evaluateTranscript(
  transcript: TranscriptEvent[],
  criteria: string[],
  options?: EvaluateTranscriptOptions
): Promise<EvaluationReport> {
  const groundings = options?.groundings;
  const usePreGrounded =
    Array.isArray(groundings) &&
    groundings.length === criteria.length;

  const validations = options?.validations;
  const useValidations =
    Array.isArray(validations) && validations.length === criteria.length;

  const [criteriaResults, session_summary] = await Promise.all([
    Promise.all(
      criteria.map((criterion, i) =>
        evaluateOneCriterion(
          transcript,
          criterion,
          usePreGrounded ? groundings![i] : undefined,
          useValidations ? validations![i] : undefined
        )
      )
    ),
    generateSessionSummary(transcript),
  ]);

  return {
    session_summary,
    criteria_results: criteriaResults,
  };
}

async function evaluateOneCriterion(
  transcript: TranscriptEvent[],
  criterion: string,
  preGrounded?: GroundedCriterion,
  preValidation?: { valid: boolean; reason?: string | null }
): Promise<CriterionResult> {
  // Prefer the persisted assessment-level verdict; the per-run LLM check is
  // only a fallback for callers with no assessment (direct-transcript runs).
  const validation = preValidation ?? (await validateCriterion(criterion));
  if (!validation.valid) {
    return {
      criterion,
      score: 0,
      confidence: "low",
      verdict:
        validation.reason ??
        "Criterion is not evaluable from a screen recording.",
      evidence: [],
      evaluable: false,
    };
  }

  const grounded =
    preGrounded && preGrounded.original === criterion
      ? preGrounded
      : await groundCriterion(criterion);
  const filtered = retrieveRelevantEvents(transcript, grounded);
  const result = await evaluateCriterionWithGrounding(
    grounded,
    filtered,
    criterion
  );
  return result;
}
