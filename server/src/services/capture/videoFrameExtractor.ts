/**
 * Smart frame extraction from recorded video.
 *
 * Strategy:
 * 1. Extract candidate frames from video at high rate (every 0.5s) using ffmpeg
 * 2. Downsample each to a tiny thumbnail using sharp
 * 3. Compare consecutive thumbnails via pixel differencing
 * 4. Keep only frames where content actually changed (>0.5% pixel diff)
 * 5. Also keep at least 1 frame every 10s as a safety net
 *
 * This catches every keystroke, agent message, scroll, and tab switch
 * while skipping truly idle frames.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import sharp from "sharp";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "./storage.js";
import { PreparedFrame } from "./framePrep.js";

const execAsync = promisify(exec);
const FFMPEG_PATH = ffmpegInstaller.path;

// Extraction config
const CANDIDATE_INTERVAL = 0.5; // Extract a candidate frame every 0.5s
const THUMB_SIZE = 128; // Thumbnail size for diffing (128x128)
const DIFF_THRESHOLD = 0.005; // 0.5% pixel change = keep frame
const CHANNEL_THRESHOLD = 25; // Per-channel difference to count as changed pixel
const MAX_IDLE_SEC = 10; // Force-keep a frame if none kept for this long

/**
 * Check if ffmpeg is available and working.
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync(`"${FFMPEG_PATH}" -version`);
    return true;
  } catch {
    console.warn("[videoExtractor] ffmpeg not available");
    return false;
  }
}

/**
 * Extract frames from session video using pixel-diff smart selection.
 * Returns PreparedFrame[] ready for the transcript pipeline.
 */
export async function extractSmartFrames(
  sessionId: string
): Promise<PreparedFrame[]> {
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session || !session.videoChunks || session.videoChunks.length === 0) {
    console.log("[videoExtractor] No video chunks found");
    return [];
  }

  // Group chunks by screen index
  const chunksByScreen = new Map<
    number,
    Array<{ storageKey: string; startTime: Date; screenIndex: number }>
  >();
  for (const chunk of session.videoChunks) {
    const c = chunk as any;
    const screenIndex = c.screenIndex as number;
    if (!chunksByScreen.has(screenIndex)) {
      chunksByScreen.set(screenIndex, []);
    }
    chunksByScreen.get(screenIndex)!.push({
      storageKey: c.storageKey,
      startTime: new Date(c.startTime),
      screenIndex,
    });
  }

  // Real wall-clock start time for timestamp computation
  const captureStartedAt =
    session.stats?.captureStartedAt ||
    (session.videoChunks[0] as any)?.startTime;
  const realStartTime = captureStartedAt
    ? new Date(captureStartedAt).getTime()
    : Date.now();

  console.log(
    `[videoExtractor] Session start: ${new Date(realStartTime).toISOString()}`
  );

  const allFrames: PreparedFrame[] = [];
  const storage = getFrameStorage();

  for (const [screenIndex, chunks] of chunksByScreen) {
    const sortedChunks = [...chunks].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `proctoring-${sessionId}-s${screenIndex}-`)
    );

    try {
      // Step 1: Download chunks to temp files
      console.log(
        `[videoExtractor] Downloading ${sortedChunks.length} chunks for screen ${screenIndex}...`
      );
      const chunkPaths: string[] = [];
      for (let i = 0; i < sortedChunks.length; i++) {
        const chunkPath = path.join(
          tmpDir,
          `chunk_${String(i).padStart(4, "0")}.webm`
        );
        const buffer = await storage.getVideoChunk(
          sortedChunks[i].storageKey
        );
        await fs.writeFile(chunkPath, buffer);
        chunkPaths.push(chunkPath);
      }

      // Step 2: Merge chunks if multiple
      let videoPath: string;
      if (chunkPaths.length === 1) {
        videoPath = chunkPaths[0];
      } else {
        const concatListPath = path.join(tmpDir, "concat.txt");
        await fs.writeFile(
          concatListPath,
          chunkPaths.map((p) => `file '${p}'`).join("\n")
        );
        videoPath = path.join(tmpDir, "merged.webm");
        console.log(
          `[videoExtractor] Merging ${chunkPaths.length} chunks...`
        );
        await execAsync(
          `"${FFMPEG_PATH}" -f concat -safe 0 -i "${concatListPath}" -c copy "${videoPath}" 2>&1`,
          { maxBuffer: 50 * 1024 * 1024 }
        );
      }

      // Step 3: Get video duration
      const durationSec = await getVideoDuration(videoPath);
      console.log(
        `[videoExtractor] Video: ${durationSec.toFixed(1)}s for screen ${screenIndex}`
      );

      // Step 4: Extract ALL candidate frames at high rate
      const candidatesDir = path.join(tmpDir, "candidates");
      await fs.mkdir(candidatesDir);

      const fps = 1 / CANDIDATE_INTERVAL;
      console.log(
        `[videoExtractor] Extracting candidates every ${CANDIDATE_INTERVAL}s (fps=${fps})...`
      );

      await execAsync(
        `"${FFMPEG_PATH}" -i "${videoPath}" -vf "fps=${fps}" "${candidatesDir}/frame_%06d.png" 2>&1`,
        { maxBuffer: 100 * 1024 * 1024 }
      );

      const candidateFiles = (await fs.readdir(candidatesDir))
        .filter((f) => f.endsWith(".png"))
        .sort();

      const totalCandidates = candidateFiles.length;
      console.log(
        `[videoExtractor] ${totalCandidates} candidate frames extracted`
      );

      if (totalCandidates === 0) continue;

      // Step 5: Generate thumbnails and diff against LAST KEPT frame.
      // This is critical: we compare each candidate to the last frame we
      // decided to keep, NOT the previous candidate. This lets small changes
      // (single characters typed) accumulate until they cross the threshold
      // (e.g. a full line or paragraph has appeared).
      let lastKeptThumb: Buffer | null = null;
      let lastKeptTimeSec = -MAX_IDLE_SEC; // Force first frame to be kept
      const keptIndices: number[] = [];

      for (let i = 0; i < totalCandidates; i++) {
        const framePath = path.join(candidatesDir, candidateFiles[i]);
        const timeSec = i * CANDIDATE_INTERVAL;

        // Generate thumbnail for diffing
        const thumbData = await sharp(framePath)
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: "fill" })
          .raw()
          .toBuffer();

        let shouldKeep = false;

        if (lastKeptThumb === null) {
          // Always keep first frame
          shouldKeep = true;
        } else {
          // Diff against last KEPT frame — changes accumulate over time
          const diffRatio = computePixelDiff(lastKeptThumb, thumbData);

          if (diffRatio >= DIFF_THRESHOLD) {
            shouldKeep = true;
          }
        }

        // Safety net: keep at least 1 frame every MAX_IDLE_SEC
        if (!shouldKeep && timeSec - lastKeptTimeSec >= MAX_IDLE_SEC) {
          shouldKeep = true;
        }

        if (shouldKeep) {
          keptIndices.push(i);
          lastKeptTimeSec = timeSec;
          lastKeptThumb = thumbData; // Only update reference on keep
        }
      }

      console.log(
        `[videoExtractor] Pixel diff kept ${keptIndices.length}/${totalCandidates} frames for screen ${screenIndex}`
      );

      // Step 6: Read kept frames and build PreparedFrame objects
      for (const idx of keptIndices) {
        const framePath = path.join(candidatesDir, candidateFiles[idx]);
        const buffer = await fs.readFile(framePath);
        const timeSec = idx * CANDIDATE_INTERVAL;
        const capturedAt = new Date(realStartTime + timeSec * 1000);
        const dimensions = parsePngDimensions(buffer);

        allFrames.push({
          storageKey: `${sessionId}/extracted/${timeSec.toFixed(2)}-${screenIndex}.png`,
          buffer,
          screenIndex,
          capturedAt,
          width: dimensions.width,
          height: dimensions.height,
        });
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Sort chronologically
  allFrames.sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()
  );

  // Update session stats
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "stats.videoStats.extractedFrameCount": allFrames.length,
    "stats.videoStats.extractionMethod":
      allFrames.length > 0 ? "fixed_interval" : null,
  });

  console.log(
    `[videoExtractor] Total: ${allFrames.length} frames from ${chunksByScreen.size} screen(s)`
  );

  return allFrames;
}

/**
 * Compute pixel difference ratio between two raw RGB thumbnail buffers.
 * Returns 0.0 (identical) to 1.0 (completely different).
 */
function computePixelDiff(bufA: Buffer, bufB: Buffer): number {
  const pixels = THUMB_SIZE * THUMB_SIZE;
  // Raw buffer is RGB (3 channels per pixel)
  const channels = 3;
  let diffPixels = 0;

  for (let i = 0; i < pixels; i++) {
    const offset = i * channels;
    const dr = Math.abs(bufA[offset] - bufB[offset]);
    const dg = Math.abs(bufA[offset + 1] - bufB[offset + 1]);
    const db = Math.abs(bufA[offset + 2] - bufB[offset + 2]);
    if (
      dr > CHANNEL_THRESHOLD ||
      dg > CHANNEL_THRESHOLD ||
      db > CHANNEL_THRESHOLD
    ) {
      diffPixels++;
    }
  }

  return diffPixels / pixels;
}

/**
 * Get video duration in seconds.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `"${FFMPEG_PATH}" -i "${videoPath}" 2>&1 | grep -o "Duration: [^,]*"`,
      { shell: "/bin/bash" }
    );
    const match = stdout.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      return (
        parseInt(match[1]) * 3600 +
        parseInt(match[2]) * 60 +
        parseFloat(match[3])
      );
    }
  } catch {
    // fall through
  }

  try {
    await execAsync(
      `"${FFMPEG_PATH}" -i "${videoPath}" -f null - 2>&1`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (err: any) {
    const output = err.stderr || err.stdout || String(err);
    const match = output.match(
      /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/
    );
    if (match) {
      return (
        parseInt(match[1]) * 3600 +
        parseInt(match[2]) * 60 +
        parseFloat(match[3])
      );
    }
  }

  console.warn(
    "[videoExtractor] Could not determine video duration, defaulting to 60s"
  );
  return 60;
}

/**
 * Parse PNG dimensions from the IHDR chunk.
 */
function parsePngDimensions(buffer: Buffer): {
  width: number;
  height: number;
} {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }
  return { width: 1920, height: 1080 };
}
