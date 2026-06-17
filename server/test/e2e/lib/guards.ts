/**
 * Pure guardrails that keep the suite from "jamming the terminal":
 *  - bound how much work can be processed inline (so a 30-minute recording is
 *    never analyzed synchronously),
 *  - estimate frame counts so callers can decide inline vs. chunked/async.
 */

import { FIXTURES } from "./config.js";

/** Estimate how many capture frames a recording of N seconds produces. */
export function estimateFrameCount(
  durationSeconds: number,
  intervalMs = Number(process.env.PROCTORING_FRAME_INTERVAL_MS || 5000)
): number {
  const interval = intervalMs > 0 ? intervalMs : 5000;
  return Math.max(0, Math.floor((durationSeconds * 1000) / interval));
}

/** Is this many frames safe to process inline within the suite's budgets? */
export function isInlineProcessable(
  frameCount: number,
  max = FIXTURES.maxInlineFrames
): boolean {
  return frameCount <= max;
}

/**
 * Throw if a workload is too large to process inline. This is the explicit
 * "don't run analysis on a 30-minute video" guard.
 */
export function assertInlineProcessable(
  frameCount: number,
  max = FIXTURES.maxInlineFrames
): void {
  if (!isInlineProcessable(frameCount, max)) {
    throw new Error(
      `Workload too large for inline analysis (${frameCount} frames > ${max}). ` +
        `Use chunked/async processing (incremental sliding-window scheduler) instead.`
    );
  }
}
