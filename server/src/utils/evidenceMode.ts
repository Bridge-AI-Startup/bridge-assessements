/**
 * Evidence mode — how we observe a candidate working on an assessment.
 *
 * Offered in the editor:
 *   "both"     record the screen for human playback, analyse the hook stream
 *   "none"     no screen recording, no workflow capture
 *
 * Leftover value (still honoured, no longer offered):
 *   "workflow" hooks-first capture with no screen share
 *
 * The removed mode: "screen" (screen recording transcribed by vision OCR) was
 * the original method and is gone. It was also the fallback for documents with
 * no `evidenceMode` field, which meant the deprecated path was the *default*
 * and quietly covered most assessments. Anything unrecognised — a missing
 * field, or a document still holding the string "screen" — now resolves to
 * "both", so legacy assessments move onto the current method on read with no
 * migration required for correctness.
 */

export type EvidenceMode = "none" | "workflow" | "both";

export const EVIDENCE_MODES: readonly EvidenceMode[] = [
  "none",
  "workflow",
  "both",
];

/** Fallback when an assessment has no (or an unrecognised) evidenceMode. */
export const DEFAULT_EVIDENCE_MODE: EvidenceMode = "both";

export function isEvidenceMode(value: unknown): value is EvidenceMode {
  return (
    typeof value === "string" &&
    (EVIDENCE_MODES as readonly string[]).includes(value)
  );
}

/**
 * The mode in force for an assessment. Always safe to call with a
 * partial/legacy assessment document. Does not consult any env flag.
 */
export function resolveEvidenceMode(
  assessment: { evidenceMode?: string | null } | null | undefined
): EvidenceMode {
  return isEvidenceMode(assessment?.evidenceMode)
    ? assessment.evidenceMode
    : DEFAULT_EVIDENCE_MODE;
}

/** Should the candidate be asked to share their screen? */
export function shouldCaptureScreen(mode: EvidenceMode): boolean {
  return mode === "both";
}

/** Should the candidate be given the capture-kit setup command? */
export function shouldCaptureWorkflow(mode: EvidenceMode): boolean {
  return mode === "workflow" || mode === "both";
}

/** Grade the capture-kit timeline. The only observational grading path there is. */
export function shouldEvaluateWorkflow(mode: EvidenceMode): boolean {
  return mode === "workflow" || mode === "both";
}
