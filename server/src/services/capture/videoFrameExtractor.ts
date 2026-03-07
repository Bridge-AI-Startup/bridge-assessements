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

const log = (msg: string, elapsedMs?: number) =>
  console.log(`[${new Date().toISOString()}] [videoExtractor] ${msg}${elapsedMs != null ? ` (+${elapsedMs}ms)` : ""}`);

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
    log("No video chunks found");
    return [];
  }
  const extractStart = Date.now();

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
  // Priority: captureStartedAt > first video chunk startTime > session createdAt
  const captureStartedAt =
    session.stats?.captureStartedAt ||
    (session.videoChunks[0] as any)?.startTime ||
    (session as any).createdAt;
  const realStartTime = captureStartedAt
    ? new Date(captureStartedAt).getTime()
    : Date.now();

  // Sanity check: if the resolved time is before year 2020, something is wrong
  if (realStartTime < new Date("2020-01-01").getTime()) {
    console.warn(`[${new Date().toISOString()}] [videoExtractor] WARNING: realStartTime resolved to ${new Date(realStartTime).toISOString()}, falling back to Date.now()`);
  }

  log(`Session start: ${new Date(realStartTime).toISOString()}; ${chunksByScreen.size} screen(s)`);

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
      const downloadStart = Date.now();
      log(`Screen ${screenIndex}: downloading ${sortedChunks.length} chunks...`);
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
      log(`Screen ${screenIndex}: downloaded ${chunkPaths.length} chunks`, Date.now() - downloadStart);

      // Step 2: Merge chunks if multiple.
      // MediaRecorder timeslice chunks are NOT standalone files — only the
      // first chunk has the WebM/EBML header. Subsequent chunks are raw
      // Cluster elements. So we binary-concatenate them into a single file
      // rather than using ffmpeg's concat demuxer (which expects each file
      // to be independently decodable).
      let videoPath: string;
      if (chunkPaths.length === 1) {
        videoPath = chunkPaths[0];
      } else {
        videoPath = path.join(tmpDir, "merged.webm");
        const mergeStart = Date.now();
        log(`Screen ${screenIndex}: binary-merging ${chunkPaths.length} chunks...`);
        const chunkBuffers = await Promise.all(
          chunkPaths.map((p) => fs.readFile(p))
        );
        await fs.writeFile(videoPath, Buffer.concat(chunkBuffers));
        log(`Screen ${screenIndex}: merge complete`, Date.now() - mergeStart);
      }

      // Step 3: Get video duration
      const durationStart = Date.now();
      const durationSec = await getVideoDuration(videoPath);
      log(`Screen ${screenIndex}: video duration ${durationSec.toFixed(1)}s`, Date.now() - durationStart);

      // Step 4: Extract ALL candidate frames at high rate
      const candidatesDir = path.join(tmpDir, "candidates");
      await fs.mkdir(candidatesDir);

      const fps = 1 / CANDIDATE_INTERVAL;
      const ffmpegStart = Date.now();
      log(`Screen ${screenIndex}: ffmpeg extracting candidates every ${CANDIDATE_INTERVAL}s (fps=${fps})...`);
      await execAsync(
        `"${FFMPEG_PATH}" -f matroska -analyzeduration 10000000 -probesize 10000000 -i "${videoPath}" -vf "fps=${fps}" "${candidatesDir}/frame_%06d.png" 2>&1`,
        { maxBuffer: 100 * 1024 * 1024 }
      );
      log(`Screen ${screenIndex}: ffmpeg extract done`, Date.now() - ffmpegStart);

      const candidateFiles = (await fs.readdir(candidatesDir))
        .filter((f) => f.endsWith(".png"))
        .sort();

      const totalCandidates = candidateFiles.length;
      log(`Screen ${screenIndex}: ${totalCandidates} candidate frames on disk`);

      if (totalCandidates === 0) continue;

      // Step 5: Generate thumbnails and diff against LAST KEPT frame.
      let lastKeptThumb: Buffer | null = null;
      let lastKeptTimeSec = -MAX_IDLE_SEC;
      const keptIndices: number[] = [];
      const diffStart = Date.now();

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

      log(`Screen ${screenIndex}: pixel diff kept ${keptIndices.length}/${totalCandidates} frames`, Date.now() - diffStart);

      // Step 6: Read kept frames and build PreparedFrame objects
      const loadStart = Date.now();
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
      log(`Screen ${screenIndex}: loaded ${keptIndices.length} frames into memory`, Date.now() - loadStart);
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

  log(`Total: ${allFrames.length} frames from ${chunksByScreen.size} screen(s)`, Date.now() - extractStart);

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

/** Parse Duration HH:MM:SS.ss from ffmpeg output; returns seconds or null. */
function parseDurationFromFfmpegOutput(output: string): number | null {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return (
    parseInt(match[1], 10) * 3600 +
    parseInt(match[2], 10) * 60 +
    parseFloat(match[3])
  );
}

/** Parse last time=HH:MM:SS.ss from ffmpeg decode progress (used when Duration: N/A, e.g. merged WebM). */
function parseLastTimeFromFfmpegOutput(output: string): number | null {
  const regex = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(output)) !== null) lastMatch = m;
  if (!lastMatch) return null;
  return (
    parseInt(lastMatch[1], 10) * 3600 +
    parseInt(lastMatch[2], 10) * 60 +
    parseFloat(lastMatch[3])
  );
}

/**
 * Get video duration in seconds.
 * Tries: (1) ffmpeg probe with grep, (2) ffmpeg decode to null and parse stderr/stdout on success or failure.
 * Merged MediaRecorder WebM chunks often report duration only when decoding; we now parse in both cases.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  // #region agent log
  fetch("http://127.0.0.1:7403/ingest/af82ea2a-dacc-45e0-807f-943c645e14fb", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "16f1b3" },
    body: JSON.stringify({
      sessionId: "16f1b3",
      hypothesisId: "entry",
      location: "videoFrameExtractor.ts:getVideoDuration",
      message: "getVideoDuration called",
      data: { videoBasename: path.basename(videoPath) },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let try1Stdout: string | undefined;
  let try1Sec: number | null = null;
  try {
    const { stdout } = await execAsync(
      `"${FFMPEG_PATH}" -f matroska -analyzeduration 10000000 -probesize 10000000 -i "${videoPath}" 2>&1 | grep -o "Duration: [^,]*"`,
      { shell: "/bin/bash" }
    );
    try1Stdout = stdout;
    try1Sec = parseDurationFromFfmpegOutput(stdout);
    if (try1Sec != null) return try1Sec;
  } catch (e) {
    try1Stdout = (e as any)?.stdout ?? "(catch no stdout)";
  }

  // #region agent log
  fetch("http://127.0.0.1:7403/ingest/af82ea2a-dacc-45e0-807f-943c645e14fb", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "16f1b3" },
    body: JSON.stringify({
      sessionId: "16f1b3",
      hypothesisId: "try1",
      location: "videoFrameExtractor.ts:after try1",
      message: "first method result",
      data: {
        stdoutLength: try1Stdout?.length ?? 0,
        stdoutSnippet: (try1Stdout ?? "").slice(0, 400),
        parsedSec: try1Sec,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  // Run decode to null; ffmpeg prints Duration to stderr before decoding. Capture output on success and failure.
  let output = "";
  let decodeSuccess = false;
  try {
    const result = await execAsync(
      `"${FFMPEG_PATH}" -f matroska -analyzeduration 10000000 -probesize 10000000 -i "${videoPath}" -f null - 2>&1`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    output = (result.stdout || "") + (result.stderr || "");
    decodeSuccess = true;
  } catch (err: any) {
    output = err.stderr || err.stdout || String(err);
  }
  let sec = parseDurationFromFfmpegOutput(output);
  if (sec == null && decodeSuccess) {
    sec = parseLastTimeFromFfmpegOutput(output);
  }

  // #region agent log
  fetch("http://127.0.0.1:7403/ingest/af82ea2a-dacc-45e0-807f-943c645e14fb", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "16f1b3" },
    body: JSON.stringify({
      sessionId: "16f1b3",
      hypothesisId: "try2",
      location: "videoFrameExtractor.ts:after decode",
      message: "second method result",
      data: {
        decodeSuccess,
        outputLength: output.length,
        outputSnippet: output.slice(0, 600),
        hasDurationSubstring: output.includes("Duration"),
        parsedSec: sec,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (sec != null) return sec;

  console.warn(`[${new Date().toISOString()}] [videoExtractor] Could not determine video duration, defaulting to 60s`);
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
