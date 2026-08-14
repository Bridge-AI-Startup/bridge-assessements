/**
 * Evidence mode — how we observe a candidate working on an assessment.
 *
 * Offered in the editor:
 *   "both"     record the screen for human playback, analyse the hook stream
 *   "none"     no screen recording, no workflow capture
 *
 * Leftover values (still honoured, no longer offered):
 *   "workflow" hooks-first capture with no screen share
 *   "screen"   screen recording + AI transcript
 *
 * The per-assessment `evidenceMode` is returned as-is. Missing/invalid values
 * resolve to "screen" so old documents keep the video + OCR path they were
 * created under. New assessments default to "both" on the Assessment schema.
 */

export type EvidenceMode = "none" | "workflow" | "both" | "screen";

export const EVIDENCE_MODES: readonly EvidenceMode[] = [
  "none",
  "workflow",
  "both",
  "screen",
];

/** Fallback when an assessment document has no evidenceMode field (legacy). */
export const DEFAULT_EVIDENCE_MODE: EvidenceMode = "screen";

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
  return mode === "screen" || mode === "both";
}

/** Should the candidate be given the capture-kit setup command? */
export function shouldCaptureWorkflow(mode: EvidenceMode): boolean {
  return mode === "workflow" || mode === "both";
}

/**
 * Where the analysis comes from. In "both" mode the video exists for human
 * playback, but the hook stream is what gets analysed — so we skip the
 * expensive frame/Gemini transcript entirely. "none" has nothing to transcribe.
 * Candidate PNG screenshots are gated on this too: they only exist to feed OCR,
 * so CandidateAssessment does not capture/upload frames unless mode is "screen".
 */
export function shouldGenerateVideoTranscript(mode: EvidenceMode): boolean {
  return mode === "screen";
}

/** Grade the capture-kit timeline instead of (or without) a video transcript. */
export function shouldEvaluateWorkflow(mode: EvidenceMode): boolean {
  return mode === "workflow" || mode === "both";
}
