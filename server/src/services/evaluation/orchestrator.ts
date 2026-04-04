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

  const [criteriaResults, session_summary] = await Promise.all([
    Promise.all(
      criteria.map((criterion, i) =>
        evaluateOneCriterion(transcript, criterion, usePreGrounded ? groundings![i] : undefined)
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
  preGrounded?: GroundedCriterion
): Promise<CriterionResult> {
  const validation = await validateCriterion(criterion);
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
