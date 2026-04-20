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
   * Prior report from a failed or interrupted run. Only prefix results whose
   * `criterion` matches the current `criteria` list in order are reused.
   */
  partial?: EvaluationReport | null;
  /** Called after each newly finished criterion and after the session summary is ready. */
  onCheckpoint?: (report: EvaluationReport) => Promise<void>;
};

/**
 * Reuse leading criterion results only when criterion strings still match (same index).
 */
export function trimCompatiblePartialReport(
  criteria: string[],
  partial: EvaluationReport | null | undefined
): EvaluationReport | undefined {
  if (!partial?.criteria_results?.length) {
    if (partial?.session_summary?.trim()) {
      return {
        criteria_results: [],
        session_summary: partial.session_summary,
      };
    }
    return undefined;
  }
  const out: CriterionResult[] = [];
  for (let i = 0; i < partial.criteria_results.length; i++) {
    if (i >= criteria.length) break;
    if (partial.criteria_results[i].criterion !== criteria[i]) break;
    out.push(partial.criteria_results[i]);
  }
  if (out.length === 0 && !partial.session_summary?.trim()) {
    return undefined;
  }
  return {
    criteria_results: out,
    session_summary: partial.session_summary ?? "",
  };
}

/**
 * Run the full evaluation pipeline: validate → ground (or use provided groundings) → retrieve → evaluate
 * per criterion (sequentially so checkpoints are meaningful), then session summary.
 * When `partial` is set, matching prefix results are skipped so retries resume after rate limits or errors.
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
  const trimmed = trimCompatiblePartialReport(criteria, options?.partial ?? undefined);
  const onCheckpoint = options?.onCheckpoint;

  if (
    trimmed &&
    trimmed.criteria_results.length === criteria.length &&
    trimmed.session_summary?.trim()
  ) {
    return {
      criteria_results: trimmed.criteria_results,
      session_summary: trimmed.session_summary,
    };
  }

  let results: CriterionResult[] = trimmed?.criteria_results
    ? [...trimmed.criteria_results]
    : [];
  let session_summary = trimmed?.session_summary?.trim()
    ? trimmed.session_summary
    : "";

  for (let i = results.length; i < criteria.length; i++) {
    const criterion = criteria[i]!;
    const preGrounded = usePreGrounded ? groundings![i] : undefined;
    const result = await evaluateOneCriterion(
      transcript,
      criterion,
      preGrounded
    );
    results.push(result);
    if (onCheckpoint) {
      await onCheckpoint({
        criteria_results: [...results],
        session_summary,
      });
    }
  }

  if (!session_summary?.trim()) {
    session_summary = await generateSessionSummary(transcript);
    if (onCheckpoint) {
      await onCheckpoint({
        criteria_results: results,
        session_summary,
      });
    }
  }

  return {
    session_summary,
    criteria_results: results,
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
