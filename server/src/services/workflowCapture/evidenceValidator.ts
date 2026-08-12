/**
 * Evidence citation validator.
 *
 * An LLM judge will happily cite a timestamp that never existed. Once a verdict
 * reaches an employer, a fabricated citation is indistinguishable from a real
 * one — and the entire pitch of this product is that every claim is one click
 * from the footage. So citations are checked against the captured timeline
 * before anything is shown, and what cannot be verified is dropped rather than
 * displayed with a caveat nobody reads.
 *
 * Dropping evidence can invalidate the score built on it, so a verdict that
 * loses most of its support is marked non-evaluable instead of quietly keeping
 * a number nothing stands behind.
 */

import type { TranscriptEvent } from "../../types/evaluation.js";

export interface EvidenceItemLike {
  ts: number;
  ts_end?: number;
  observation: string;
}

export interface CriterionResultLike {
  criterion: string;
  score: number;
  confidence: "high" | "medium" | "low";
  verdict: string;
  evidence: EvidenceItemLike[];
  evaluable: boolean;
}

export interface ValidationOutcome {
  result: CriterionResultLike;
  kept: number;
  dropped: number;
  /** Why each dropped citation failed, for debugging the judge prompt. */
  reasons: string[];
  /** True when so much support was dropped the score no longer means anything. */
  invalidated: boolean;
}

/**
 * How far a citation may sit from a real event and still count.
 *
 * Not zero: the judge is summarising a stretch of activity and may cite the
 * middle of it rather than an exact event boundary. Wide enough to be fair,
 * narrow enough that a hallucinated timestamp in an empty part of the session
 * still fails.
 */
const TOLERANCE_SECONDS = 30;

/** Below this share of surviving evidence, the score is not defensible. */
const MIN_SURVIVING_RATIO = 0.5;

export interface ValidateOptions {
  toleranceSeconds?: number;
  /** Session length; citations beyond it are impossible by construction. */
  maxTimestampSeconds?: number | null;
}

/**
 * Check one verdict's citations against the timeline it was supposedly drawn from.
 */
export function validateCriterionEvidence(
  result: CriterionResultLike,
  timeline: TranscriptEvent[],
  options: ValidateOptions = {}
): ValidationOutcome {
  const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
  const maxTs = options.maxTimestampSeconds ?? null;
  const reasons: string[] = [];

  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const kept: EvidenceItemLike[] = [];

  for (const item of evidence) {
    const ts = Number(item?.ts);
    if (!Number.isFinite(ts) || ts < 0) {
      reasons.push(`dropped: non-numeric or negative ts (${item?.ts})`);
      continue;
    }
    if (maxTs != null && ts > maxTs + tolerance) {
      reasons.push(
        `dropped: ts ${ts}s is beyond the session (${Math.round(maxTs)}s)`
      );
      continue;
    }
    if (!item?.observation || !String(item.observation).trim()) {
      reasons.push(`dropped: citation at ${ts}s has no observation text`);
      continue;
    }

    // Something must actually have been captured near the cited moment.
    const near = timeline.some((e) => {
      const start = e.ts - tolerance;
      const end = (e.ts_end ?? e.ts) + tolerance;
      return ts >= start && ts <= end;
    });
    if (!near) {
      reasons.push(`dropped: nothing captured within ${tolerance}s of ${ts}s`);
      continue;
    }
    kept.push(item);
  }

  const dropped = evidence.length - kept.length;
  // A verdict that cited nothing was already unsupported; dropping nothing does
  // not make it worse, but it should not be presented as evaluable either.
  const survivingRatio = evidence.length > 0 ? kept.length / evidence.length : 0;
  const invalidated =
    evidence.length > 0 && survivingRatio < MIN_SURVIVING_RATIO;

  return {
    result: {
      ...result,
      evidence: kept,
      evaluable: result.evaluable && kept.length > 0 && !invalidated,
      verdict: invalidated
        ? `${result.verdict}\n\n[Withheld: ${dropped} of ${evidence.length} cited moments could not be matched to captured activity, so this score is not reliable.]`
        : result.verdict,
    },
    kept: kept.length,
    dropped,
    reasons,
    invalidated,
  };
}

/** Validate a full set of criterion results against one timeline. */
export function validateAllEvidence(
  results: CriterionResultLike[],
  timeline: TranscriptEvent[],
  options: ValidateOptions = {}
): {
  results: CriterionResultLike[];
  totalKept: number;
  totalDropped: number;
  invalidatedCriteria: string[];
  reasons: string[];
} {
  const maxTimestampSeconds =
    options.maxTimestampSeconds ??
    (timeline.length
      ? Math.max(...timeline.map((e) => e.ts_end ?? e.ts))
      : null);

  let totalKept = 0;
  let totalDropped = 0;
  const invalidatedCriteria: string[] = [];
  const reasons: string[] = [];
  const out: CriterionResultLike[] = [];

  for (const r of results) {
    const outcome = validateCriterionEvidence(r, timeline, {
      ...options,
      maxTimestampSeconds,
    });
    totalKept += outcome.kept;
    totalDropped += outcome.dropped;
    if (outcome.invalidated) invalidatedCriteria.push(r.criterion);
    for (const reason of outcome.reasons) {
      reasons.push(`[${r.criterion}] ${reason}`);
    }
    out.push(outcome.result);
  }

  return { results: out, totalKept, totalDropped, invalidatedCriteria, reasons };
}
