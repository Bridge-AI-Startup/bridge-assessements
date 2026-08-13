/**
 * Evidence mode — how we observe a candidate working on an assessment.
 *
 *   "none"     no screen recording, no workflow capture
 *   "workflow" hooks-first AI-workflow capture via capture-kit
 *   "both"     record the screen for human playback, analyse the hook stream
 *   "screen"   legacy: screen recording + AI transcript (no longer offered in the editor)
 *
 * Two switches, deliberately: a per-assessment `evidenceMode` chosen by the
 * employer, and the server-wide WORKFLOW_CAPTURE_ENABLED master switch. The
 * master switch always wins downward for workflow/both — an assessment
 * configured for workflow capture on a deployment that has it turned off
 * silently falls back to screen recording rather than collecting nothing at
 * all. "none" is never rewritten.
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

/** Is hooks-first capture available on this deployment at all? */
export function workflowCaptureAvailable(): boolean {
  return process.env.WORKFLOW_CAPTURE_ENABLED === "true";
}

/**
 * The mode actually in force for an assessment, after applying the master
 * switch. Always safe to call with a partial/legacy assessment document.
 */
export function resolveEvidenceMode(
  assessment: { evidenceMode?: string | null } | null | undefined
): EvidenceMode {
  const requested = isEvidenceMode(assessment?.evidenceMode)
    ? assessment.evidenceMode
    : DEFAULT_EVIDENCE_MODE;
  if (requested === "none") return "none";
  if (requested === "screen") return "screen";
  if (!workflowCaptureAvailable()) return "screen";
  return requested === "both" ? "both" : "workflow";
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
 */
export function shouldGenerateVideoTranscript(mode: EvidenceMode): boolean {
  return mode === "screen";
}

/** Grade the capture-kit timeline instead of (or without) a video transcript. */
export function shouldEvaluateWorkflow(mode: EvidenceMode): boolean {
  return mode === "workflow" || mode === "both";
}
