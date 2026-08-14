import fs from "fs/promises";

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

type VideoChunkMetadata = {
  screenIndex: number;
  startTime: Date;
  endTime?: Date;
};

/**
 * Append the chunk entry + stats to the session document.
 * Guarded so a client retry of an already-recorded chunk (same storageKey) neither
 * duplicates the array entry nor double-counts stats — the blob overwrite is a no-op,
 * and the merge would otherwise include the segment twice.
 */
async function recordVideoChunkOnSession(
  sessionId: string,
  storageKey: string,
  sizeBytes: number,
  metadata: VideoChunkMetadata
): Promise<void> {
  const startValid =
    metadata.startTime instanceof Date && !Number.isNaN(metadata.startTime.getTime());
  const endValid =
    metadata.endTime instanceof Date && !Number.isNaN(metadata.endTime.getTime());

  const chunkEntry = {
    storageKey,
    screenIndex: metadata.screenIndex,
    startTime: metadata.startTime,
    endTime: metadata.endTime || null,
    sizeBytes,
  };

  const chunkDurationSec = endValid
    ? (metadata.endTime!.getTime() - metadata.startTime.getTime()) / 1000
    : 0;

  const update: Record<string, unknown> = {
    $push: { videoChunks: chunkEntry },
    $inc: {
      "stats.videoStats.totalChunks": 1,
      "stats.videoStats.totalVideoSizeBytes": sizeBytes,
      "stats.videoStats.durationSeconds": chunkDurationSec,
    },
  };
  if (startValid) {
    update.$min = { "stats.captureStartedAt": metadata.startTime };
  }
  const endForMax = endValid ? metadata.endTime : startValid ? metadata.startTime : null;
  if (endForMax) {
    update.$max = { "stats.captureEndedAt": endForMax };
  }

  await ProctoringSessionModel.findOneAndUpdate(
    { _id: sessionId, "videoChunks.storageKey": { $ne: storageKey } },
    update
  );

  // `$min` does not overwrite BSON null (null < Date), and the schema default
  // is null — so the first chunk never stamped captureStartedAt. Screen
  // classification and Review seeks both key off that field.
  if (startValid) {
    await ProctoringSessionModel.updateOne(
      {
        _id: sessionId,
        $or: [
          { "stats.captureStartedAt": null },
          { "stats.captureStartedAt": { $exists: false } },
        ],
      },
      { $set: { "stats.captureStartedAt": metadata.startTime } },
    );
  }
}

/**
 * Store a video chunk and update the session document.
 */
export async function storeVideoChunk(
  sessionId: string,
  buffer: Buffer,
  metadata: VideoChunkMetadata
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

  await recordVideoChunkOnSession(sessionId, storageKey, buffer.length, metadata);

  return { storageKey };
}

/**
 * Store a video chunk by streaming from a local file (e.g. a multer disk upload),
 * so the chunk is never held in RAM. Same key layout and session bookkeeping as
 * storeVideoChunk.
 */
export async function storeVideoChunkFromFile(
  sessionId: string,
  filePath: string,
  metadata: VideoChunkMetadata
): Promise<{ storageKey: string }> {
  const storage = getFrameStorage();
  const ts = metadata.startTime.getTime();
  const storageKey = `${sessionId}/video/${ts}-${metadata.screenIndex}.webm`;

  let sizeBytes: number;
  try {
    sizeBytes = (await fs.stat(filePath)).size;
    await storage.storeBlobFromFile(storageKey, filePath);
  } catch (err) {
    console.error("Video chunk storage error:", err);
    throw ProctoringError.STORAGE_ERROR;
  }

  await recordVideoChunkOnSession(sessionId, storageKey, sizeBytes, metadata);

  return { storageKey };
}
