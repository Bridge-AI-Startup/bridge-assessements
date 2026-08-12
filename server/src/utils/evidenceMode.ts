/**
 * Evidence mode — how we observe a candidate working on an assessment.
 *
 *   "screen"   screen recording + AI transcript (the original strategy, default)
 *   "workflow" hooks-first AI-workflow capture via capture-kit
 *   "both"     record the screen for human playback, analyse the hook stream
 *
 * Two switches, deliberately: a per-assessment `evidenceMode` chosen by the
 * employer, and the server-wide WORKFLOW_CAPTURE_ENABLED master switch. The
 * master switch always wins downward — an assessment configured for workflow
 * capture on a deployment that has it turned off silently falls back to screen
 * recording rather than collecting nothing at all.
 */

export type EvidenceMode = "screen" | "workflow" | "both";

export const DEFAULT_EVIDENCE_MODE: EvidenceMode = "screen";

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
  const requested = (assessment?.evidenceMode as EvidenceMode) || DEFAULT_EVIDENCE_MODE;
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
 * expensive frame/Gemini transcript entirely.
 */
export function shouldGenerateVideoTranscript(mode: EvidenceMode): boolean {
  return mode === "screen";
}
