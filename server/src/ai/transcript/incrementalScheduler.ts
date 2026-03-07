/**
 * Sliding-window transcript scheduler: runs incremental transcript generation
 * for active (and optionally recently completed) proctoring sessions on a fixed interval.
 */

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { generateTranscriptIncremental } from "./generator.js";

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

let intervalId: ReturnType<typeof setInterval> | null = null;

function getIntervalMs(): number {
  const raw = process.env.TRANSCRIPT_INCREMENTAL_INTERVAL_MS;
  if (raw == null || raw === "") return DEFAULT_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

export function isIncrementalEnabled(): boolean {
  return process.env.TRANSCRIPT_INCREMENTAL_ENABLED === "true";
}

async function runIncrementalForSession(sessionId: string): Promise<void> {
  try {
    const session = await ProctoringSessionModel.findById(sessionId)
      .select("transcript stats")
      .lean();
    if (!session) return;

    const transcript = (session as any).transcript;
    const stats = (session as any).stats;
    const lastAt = transcript?.lastIncrementalAt
      ? new Date(transcript.lastIncrementalAt).getTime()
      : null;
    const captureStartedAt = stats?.captureStartedAt
      ? new Date(stats.captureStartedAt).getTime()
      : 0;
    const sinceMs = lastAt ?? captureStartedAt ?? 0;

    const result = await generateTranscriptIncremental(sessionId, { sinceMs });
    if (result.newSegmentCount > 0 || result.frameCount > 0) {
      console.log(
        `[transcript-incremental] ${sessionId}: ${result.newSegmentCount} new segments, ${result.mergedSegmentCount} total, ${result.frameCount} frames`
      );
    }
  } catch (err) {
    console.error(`[transcript-incremental] Session ${sessionId} failed:`, err);
  }
}

async function tick(): Promise<void> {
  if (process.env.TRANSCRIPT_GENERATION_ENABLED === "false") return;

  try {
    const sessions = await ProctoringSessionModel.find(
      {
        status: "active",
        "transcript.status": { $ne: "generating" },
      },
      { _id: 1 }
    )
      .lean()
      .exec();

    for (const s of sessions) {
      await runIncrementalForSession((s as any)._id.toString());
    }
  } catch (err) {
    console.error("[transcript-incremental] Scheduler tick failed:", err);
  }
}

export function startIncrementalScheduler(): void {
  if (!isIncrementalEnabled()) return;

  const intervalMs = getIntervalMs();
  intervalId = setInterval(tick, intervalMs);
  console.log(
    `[transcript-incremental] Scheduler started (interval ${intervalMs}ms)`
  );
  tick();
}

export function stopIncrementalScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[transcript-incremental] Scheduler stopped");
  }
}
