import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "./storage.js";
import { ProctoringError } from "../../errors/proctoring.js";

/**
 * Store a frame buffer and update the session document.
 */
export async function storeFrame(
  sessionId: string,
  buffer: Buffer,
  metadata: {
    screenIndex: number;
    capturedAt: Date;
    width?: number;
    height?: number;
    clientHash?: string;
  }
): Promise<{ storageKey: string }> {
  const storage = getFrameStorage();
  const ts = metadata.capturedAt.getTime();
  const storageKey = `${sessionId}/frames/${ts}-${metadata.screenIndex}.png`;

  try {
    await storage.storeFrame(storageKey, buffer);
  } catch (err) {
    console.error("Frame storage error:", err);
    throw ProctoringError.STORAGE_ERROR;
  }

  const frameEntry = {
    storageKey,
    screenIndex: metadata.screenIndex,
    capturedAt: metadata.capturedAt,
    sizeBytes: buffer.length,
    width: metadata.width || null,
    height: metadata.height || null,
    isDuplicate: false,
    clientHash: metadata.clientHash || null,
  };

  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    $push: { frames: frameEntry },
    $inc: {
      "stats.totalFrames": 1,
      "stats.uniqueFrames": 1,
      "stats.totalSizeBytes": buffer.length,
    },
    $min: { "stats.captureStartedAt": metadata.capturedAt },
    $max: { "stats.captureEndedAt": metadata.capturedAt },
  });

  return { storageKey };
}

/**
 * Retrieve a frame buffer from storage.
 */
export async function retrieveFrame(storageKey: string): Promise<Buffer> {
  const storage = getFrameStorage();
  return storage.getFrame(storageKey);
}

/**
 * Store a video chunk and update the session document.
 */
export async function storeVideoChunk(
  sessionId: string,
  buffer: Buffer,
  metadata: {
    screenIndex: number;
    startTime: Date;
    endTime?: Date;
  }
): Promise<{ storageKey: string }> {
  const storage = getFrameStorage();
  const ts = metadata.startTime.getTime();
  const storageKey = `${sessionId}/video/${ts}-${metadata.screenIndex}.webm`;

  try {
    await storage.storeVideoChunk(storageKey, buffer);
  } catch (err) {
    console.error("Video chunk storage error:", err);
    throw ProctoringError.STORAGE_ERROR;
  }

  const chunkEntry = {
    storageKey,
    screenIndex: metadata.screenIndex,
    startTime: metadata.startTime,
    endTime: metadata.endTime || null,
    sizeBytes: buffer.length,
  };

  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    $push: { videoChunks: chunkEntry },
    $inc: {
      "stats.videoStats.totalChunks": 1,
      "stats.videoStats.totalVideoSizeBytes": buffer.length,
    },
    $min: { "stats.captureStartedAt": metadata.startTime },
    $max: { "stats.captureEndedAt": metadata.startTime },
  });

  return { storageKey };
}
