/**
 * Milestone logs for behavioral grading (always on — use `[behavioral]` to grep).
 * Set BEHAVIORAL_GRADING_LOG=0 to silence.
 */
export function behavioralInfo(
  phase: string,
  detail?: Record<string, unknown>
): void {
  if (process.env.BEHAVIORAL_GRADING_LOG === "0") return;
  const ts = new Date().toISOString();
  const extra = detail !== undefined ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[behavioral ${ts}] ${phase}${extra}`);
}
