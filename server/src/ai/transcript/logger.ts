/**
 * Timestamped logging for video processing and transcript generation.
 * Use for consistent [ISO timestamp] [tag] message (+Nms) format.
 */
export function ts(): string {
  return new Date().toISOString();
}

export function logTs(
  tag: string,
  message: string,
  elapsedMs?: number
): void {
  const suffix = elapsedMs != null ? ` (+${elapsedMs}ms)` : "";
  console.log(`[${ts()}] [${tag}] ${message}${suffix}`);
}
