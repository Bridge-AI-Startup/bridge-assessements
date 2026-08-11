import fs from "fs/promises";
import os from "os";
import path from "path";

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "./storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import {
  extractSmartFrames,
  isFFmpegAvailable,
  makeDiskBackedFrame,
} from "./videoFrameExtractor.js";

const log = (msg: string, elapsedMs?: number) =>
  console.log(`[${new Date().toISOString()}] [framePrep] ${msg}${elapsedMs != null ? ` (+${elapsedMs}ms)` : ""}`);

/**
 * Boundary contract consumed by ai/transcript/generator.ts.
 * This is the ONLY interface the AI module knows about.
 *
 * `buffer` may be a lazy disk-backed getter (see makeDiskBackedFrame): read it
 * when needed and let it go out of scope — do NOT collect all frames' buffers
 * into a long-lived structure, that reintroduces the whole-session-in-RAM OOM.
 */
export interface PreparedFrame {
  storageKey: string;
  buffer: Buffer;
  screenIndex: number;
  capturedAt: Date;
  width: number;
  height: number;
}

export interface PreparedSidecarEvent {
  type: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface PreparedSessionData {
  sessionId: string;
  frames: PreparedFrame[];
  sidecarEvents: PreparedSidecarEvent[];
  screens: Array<{ screenIndex: number; label: string | null }>;
  captureStartedAt: Date | null;
  captureEndedAt: Date | null;
  /**
   * Deletes the temp files backing `frames`. The caller that triggered
   * preparation must invoke this (in a finally) once processing is done.
   */
  cleanup?: () => Promise<void>;
}

/**
 * Load and prepare session data for transcript generation.
 * Tries video-based smart frame extraction first (if video chunks exist).
 * Falls back to screenshot-based frames if video extraction fails or yields nothing.
 */
export async function prepareSessionForTranscript(
  sessionId: string
): Promise<PreparedSessionData> {
  const startTotal = Date.now();
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  let preparedFrames: PreparedFrame[] = [];
  let framesCleanup: (() => Promise<void>) | undefined;
  const hasVideo =
    (session.videoChunks && session.videoChunks.length > 0) ||
    (session as any).mergedVideo?.status === "ready";

  if (hasVideo) {
    const ffmpegOk = await isFFmpegAvailable();
    if (ffmpegOk) {
      log(
        `Video source available (chunks=${session.videoChunks?.length ?? 0}, merged=${(session as any).mergedVideo?.status === "ready"}), starting smart extraction...`,
      );
      try {
        const extractStart = Date.now();
        const extracted = await extractSmartFrames(sessionId);
        preparedFrames = extracted.frames;
        framesCleanup = extracted.cleanup;
        log(`Video extraction produced ${preparedFrames.length} frames`, Date.now() - extractStart);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] [framePrep] Video extraction failed, falling back to screenshots:`, err);
        preparedFrames = [];
      }
    } else {
      log("ffmpeg not available, falling back to screenshots");
    }
  }

  if (preparedFrames.length === 0) {
    if (framesCleanup) {
      await framesCleanup().catch(() => {});
      framesCleanup = undefined;
    }
    log("Using screenshot-based frames (fallback)");
    const screenshotStart = Date.now();
    const screenshots = await loadScreenshotFrames(sessionId, session);
    preparedFrames = screenshots.frames;
    framesCleanup = screenshots.cleanup;
    log(`Loaded ${preparedFrames.length} screenshot frames`, Date.now() - screenshotStart);

    if (hasVideo) {
      await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
        "stats.videoStats.extractionMethod": "screenshot_fallback",
      });
    }
  }

  const sidecarEvents: PreparedSidecarEvent[] = session.sidecarEvents
    .map((e: any) => ({
      type: e.type,
      timestamp: new Date(e.timestamp),
      metadata: e.metadata || {},
    }))
    .sort(
      (a: PreparedSidecarEvent, b: PreparedSidecarEvent) =>
        a.timestamp.getTime() - b.timestamp.getTime()
    );

  const screens = session.screens.map((s: any) => ({
    screenIndex: s.screenIndex,
    label: s.label || null,
  }));

  log(`prepareSessionForTranscript done: ${preparedFrames.length} frames, ${sidecarEvents.length} sidecar events`, Date.now() - startTotal);
  return {
    sessionId,
    frames: preparedFrames,
    sidecarEvents,
    screens,
    captureStartedAt: session.stats.captureStartedAt || null,
    captureEndedAt: session.stats.captureEndedAt || null,
    cleanup: framesCleanup,
  };
}

/**
 * Prepare session data for transcript generation, restricted to frames (and sidecar events)
 * with timestamp >= sinceMs. Used by the sliding-window incremental processor.
 */
export async function prepareSessionForTranscriptSince(
  sessionId: string,
  sinceMs: number
): Promise<PreparedSessionData> {
  const full = await prepareSessionForTranscript(sessionId);
  const sinceDate = new Date(sinceMs);
  const frames = full.frames.filter((f) => f.capturedAt >= sinceDate);
  const sidecarEvents = full.sidecarEvents.filter((e) => e.timestamp >= sinceDate);
  return {
    ...full,
    frames,
    sidecarEvents,
  };
}

/**
 * Load screenshot frames from storage into a temp dir, returning disk-backed
 * frames (one buffer resident at a time during download, lazy `.buffer` after).
 */
async function loadScreenshotFrames(
  sessionId: string,
  session: any
): Promise<{ frames: PreparedFrame[]; cleanup: () => Promise<void> }> {
  const storage = getFrameStorage();

  const nonDuplicateFrames = session.frames
    .filter((f: any) => !f.isDuplicate)
    .sort(
      (a: any, b: any) =>
        new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()
    );

  const frameDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `proctoring-${sessionId}-shots-`)
  );
  const cleanup = async () => {
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const preparedFrames: PreparedFrame[] = [];
    for (let i = 0; i < nonDuplicateFrames.length; i++) {
      const frame = nonDuplicateFrames[i];
      try {
        const buffer = await storage.getFrame(frame.storageKey);
        const filePath = path.join(
          frameDir,
          `${String(i).padStart(6, "0")}.png`
        );
        await fs.writeFile(filePath, buffer);
        preparedFrames.push(
          makeDiskBackedFrame({
            storageKey: frame.storageKey,
            filePath,
            screenIndex: frame.screenIndex,
            capturedAt: new Date(frame.capturedAt),
            width: frame.width || 0,
            height: frame.height || 0,
          })
        );
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] [framePrep] Failed to load frame ${frame.storageKey}, skipping:`, err);
      }
    }

    return { frames: preparedFrames, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
