import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "./storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import {
  extractSmartFrames,
  isFFmpegAvailable,
} from "./videoFrameExtractor.js";

/**
 * Boundary contract consumed by ai/transcript/generator.ts.
 * This is the ONLY interface the AI module knows about.
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
}

/**
 * Load and prepare session data for transcript generation.
 * Tries video-based smart frame extraction first (if video chunks exist).
 * Falls back to screenshot-based frames if video extraction fails or yields nothing.
 */
export async function prepareSessionForTranscript(
  sessionId: string
): Promise<PreparedSessionData> {
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  let preparedFrames: PreparedFrame[] = [];

  // Try video-based extraction first
  const hasVideo =
    session.videoChunks && session.videoChunks.length > 0;

  if (hasVideo) {
    const ffmpegOk = await isFFmpegAvailable();
    if (ffmpegOk) {
      console.log(
        `[framePrep] Video chunks found (${session.videoChunks.length}), attempting smart extraction...`
      );
      try {
        preparedFrames = await extractSmartFrames(sessionId);
        console.log(
          `[framePrep] Video extraction produced ${preparedFrames.length} frames`
        );
      } catch (err) {
        console.error("[framePrep] Video extraction failed, falling back to screenshots:", err);
        preparedFrames = [];
      }
    } else {
      console.log(
        "[framePrep] ffmpeg not available, falling back to screenshots"
      );
    }
  }

  // Fallback to screenshot frames
  if (preparedFrames.length === 0) {
    console.log("[framePrep] Using screenshot-based frames (fallback)");
    preparedFrames = await loadScreenshotFrames(session);

    // Update extraction method stat
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

  return {
    sessionId,
    frames: preparedFrames,
    sidecarEvents,
    screens,
    captureStartedAt: session.stats.captureStartedAt || null,
    captureEndedAt: session.stats.captureEndedAt || null,
  };
}

/**
 * Load screenshot frames from storage (original behavior).
 */
async function loadScreenshotFrames(session: any): Promise<PreparedFrame[]> {
  const storage = getFrameStorage();

  const nonDuplicateFrames = session.frames
    .filter((f: any) => !f.isDuplicate)
    .sort(
      (a: any, b: any) =>
        new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()
    );

  const preparedFrames: PreparedFrame[] = [];
  for (const frame of nonDuplicateFrames) {
    try {
      const buffer = await storage.getFrame(frame.storageKey);
      preparedFrames.push({
        storageKey: frame.storageKey,
        buffer,
        screenIndex: frame.screenIndex,
        capturedAt: new Date(frame.capturedAt),
        width: frame.width || 0,
        height: frame.height || 0,
      });
    } catch (err) {
      console.warn(`Failed to load frame ${frame.storageKey}, skipping:`, err);
    }
  }

  return preparedFrames;
}
