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
import { readFileSync } from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "./storage.js";
import { PreparedFrame } from "./framePrep.js";
import { mergeLocalFilesSequential } from "./videoMerge.js";

/**
 * PreparedFrame whose pixel data lives on disk and is read on each `.buffer`
 * access instead of being held in RAM. Holding every kept frame of a long
 * session in one array is what OOMed the server; consumers touch frames
 * sequentially (per vision batch / per region crop), so a lazy read keeps
 * peak memory at one batch instead of the whole session.
 */
export function makeDiskBackedFrame(meta: {
  storageKey: string;
  filePath: string;
  screenIndex: number;
  capturedAt: Date;
  width: number;
  height: number;
}): PreparedFrame {
  return {
    storageKey: meta.storageKey,
    screenIndex: meta.screenIndex,
    capturedAt: meta.capturedAt,
    width: meta.width,
    height: meta.height,
    get buffer(): Buffer {
      return readFileSync(meta.filePath);
    },
  };
}

export interface ExtractedFrames {
  frames: PreparedFrame[];
  /** Deletes the on-disk kept frames. Call after the transcript pipeline is done with them. */
  cleanup: () => Promise<void>;
}

const execAsync = promisify(exec);
const FFMPEG_PATH = ffmpegInstaller.path;

const log = (msg: string, elapsedMs?: number) =>
  console.log(`[${new Date().toISOString()}] [videoExtractor] ${msg}${elapsedMs != null ? ` (+${elapsedMs}ms)` : ""}`);

// Extraction config
// Candidate extraction cadence in seconds. Default 0.5s catches every keystroke
// for normal-length sessions. For very long recordings processed in one batch
// (e.g. backfill/seeding of 30+ min clips), 0.5s yields thousands of candidate
// frames and an impractically long transcription; override via env to coarsen.
const CANDIDATE_INTERVAL = (() => {
  const raw = Number(process.env.PROCTORING_CANDIDATE_INTERVAL_SEC);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.5;
})();
const THUMB_SIZE = 128; // Thumbnail size for diffing (128x128)
const DIFF_THRESHOLD = 0.005; // 0.5% pixel change = keep frame
const CHANNEL_THRESHOLD = 25; // Per-channel difference to count as changed pixel
const MAX_IDLE_SEC = 10; // Force-keep a frame if none kept for this long
/** Fit frames inside this box (preserves aspect ratio); reduces RAM vs full screen. */
const EXTRACT_BOX_W = 1280;
const EXTRACT_BOX_H = 720;

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
 * Run ffmpeg + pixel-diff selection for one on-disk WebM (already merged if needed).
 */
async function extractFramesFromVideoPath(
  sessionId: string,
  screenIndex: number,
  videoPath: string,
  realStartTime: number,
  keepDir: string,
): Promise<PreparedFrame[]> {
  const scratchDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `proctoring-${sessionId}-s${screenIndex}-scratch-`),
  );
  const out: PreparedFrame[] = [];
  try {
    const durationStart = Date.now();
    const durationSec = await getVideoDuration(videoPath);
    log(
      `Screen ${screenIndex}: video duration ${durationSec.toFixed(1)}s`,
      Date.now() - durationStart,
    );

    const candidatesDir = path.join(scratchDir, "candidates");
    await fs.mkdir(candidatesDir);

    const fps = 1 / CANDIDATE_INTERVAL;
    const vf = `fps=${fps},scale=${EXTRACT_BOX_W}:${EXTRACT_BOX_H}:force_original_aspect_ratio=decrease`;
    const ffmpegStart = Date.now();
    log(
      `Screen ${screenIndex}: ffmpeg extracting candidates every ${CANDIDATE_INTERVAL}s (fps=${fps}, max ${EXTRACT_BOX_W}x${EXTRACT_BOX_H})...`,
    );
    await execAsync(
      `"${FFMPEG_PATH}" -f matroska -analyzeduration 10000000 -probesize 10000000 -i "${videoPath}" -vf "${vf}" "${candidatesDir}/frame_%06d.png" 2>&1`,
      { maxBuffer: 100 * 1024 * 1024 },
    );
    log(`Screen ${screenIndex}: ffmpeg extract done`, Date.now() - ffmpegStart);

    const candidateFiles = (await fs.readdir(candidatesDir))
      .filter((f) => f.endsWith(".png"))
      .sort();

    const totalCandidates = candidateFiles.length;
    log(`Screen ${screenIndex}: ${totalCandidates} candidate frames on disk`);

    if (totalCandidates === 0) return [];

    let lastKeptThumb: Buffer | null = null;
    let lastKeptTimeSec = -MAX_IDLE_SEC;
    const keptIndices: number[] = [];
    const diffStart = Date.now();

    for (let i = 0; i < totalCandidates; i++) {
      const framePath = path.join(candidatesDir, candidateFiles[i]);
      const timeSec = i * CANDIDATE_INTERVAL;

      const thumbData = await sharp(framePath)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "fill" })
        .raw()
        .toBuffer();

      let shouldKeep = false;

      if (lastKeptThumb === null) {
        shouldKeep = true;
      } else {
        const diffRatio = computePixelDiff(lastKeptThumb, thumbData);
        if (diffRatio >= DIFF_THRESHOLD) {
          shouldKeep = true;
        }
      }

      if (!shouldKeep && timeSec - lastKeptTimeSec >= MAX_IDLE_SEC) {
        shouldKeep = true;
      }

      if (shouldKeep) {
        keptIndices.push(i);
        lastKeptTimeSec = timeSec;
        lastKeptThumb = thumbData;
      }
    }

    log(
      `Screen ${screenIndex}: pixel diff kept ${keptIndices.length}/${totalCandidates} frames`,
      Date.now() - diffStart,
    );

    const keepStart = Date.now();
    for (const idx of keptIndices) {
      const framePath = path.join(candidatesDir, candidateFiles[idx]);
      const timeSec = idx * CANDIDATE_INTERVAL;
      const capturedAt = new Date(realStartTime + timeSec * 1000);
      const keptPath = path.join(
        keepDir,
        `s${screenIndex}-${timeSec.toFixed(2)}.png`,
      );
      try {
        await fs.rename(framePath, keptPath);
      } catch {
        // e.g. EXDEV if keepDir ends up on another filesystem
        await fs.copyFile(framePath, keptPath);
      }
      const dimensions = await readPngDimensionsFromFile(keptPath);

      out.push(
        makeDiskBackedFrame({
          storageKey: `${sessionId}/extracted/${timeSec.toFixed(2)}-${screenIndex}.png`,
          filePath: keptPath,
          screenIndex,
          capturedAt,
          width: dimensions.width,
          height: dimensions.height,
        }),
      );
    }
    log(
      `Screen ${screenIndex}: kept ${keptIndices.length} frames on disk (lazy-loaded)`,
      Date.now() - keepStart,
    );
    return out;
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract frames from session video using pixel-diff smart selection.
 * Returned frames are disk-backed (lazy `.buffer`); callers own `cleanup()`
 * and must invoke it once the transcript pipeline is done with the frames.
 */
export async function extractSmartFrames(
  sessionId: string,
): Promise<ExtractedFrames> {
  const noop = async () => {};
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) {
    log("No session");
    return { frames: [], cleanup: noop };
  }

  const mergedReady =
    (session as any).mergedVideo?.status === "ready" &&
    (session as any).mergedVideo?.storageKey;

  const extractStart = Date.now();

  const captureStartedAt =
    session.stats?.captureStartedAt ||
    (session.videoChunks?.[0] as any)?.startTime ||
    (session as any).createdAt;
  const realStartTime = captureStartedAt
    ? new Date(captureStartedAt).getTime()
    : Date.now();

  if (realStartTime < new Date("2020-01-01").getTime()) {
    console.warn(
      `[${new Date().toISOString()}] [videoExtractor] WARNING: realStartTime resolved to ${new Date(realStartTime).toISOString()}, falling back to Date.now()`,
    );
  }

  const allFrames: PreparedFrame[] = [];
  const storage = getFrameStorage();
  let screenCountForLog = 0;

  const keepDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `proctoring-${sessionId}-kept-`),
  );
  const cleanup = async () => {
    await fs.rm(keepDir, { recursive: true, force: true }).catch(() => {});
  };

  const groupChunksByScreen = (
    filter?: (screenIndex: number) => boolean,
  ): Map<number, Array<{ storageKey: string; startTime: Date; screenIndex: number }>> => {
    const byScreen = new Map<
      number,
      Array<{ storageKey: string; startTime: Date; screenIndex: number }>
    >();
    for (const chunk of session.videoChunks ?? []) {
      const c = chunk as any;
      const screenIndex = (c.screenIndex as number) ?? 0;
      if (filter && !filter(screenIndex)) continue;
      if (!byScreen.has(screenIndex)) {
        byScreen.set(screenIndex, []);
      }
      byScreen.get(screenIndex)!.push({
        storageKey: c.storageKey,
        startTime: new Date(c.startTime),
        screenIndex,
      });
    }
    return byScreen;
  };

  const processChunkScreens = async (
    chunksByScreen: Map<
      number,
      Array<{ storageKey: string; startTime: Date; screenIndex: number }>
    >,
  ): Promise<void> => {
    for (const [screenIndex, chunks] of chunksByScreen) {
      const sortedChunks = [...chunks].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );

      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `proctoring-${sessionId}-s${screenIndex}-`),
      );

      try {
        const downloadStart = Date.now();
        log(`Screen ${screenIndex}: downloading ${sortedChunks.length} chunks...`);
        const chunkPaths: string[] = [];
        for (let i = 0; i < sortedChunks.length; i++) {
          const chunkPath = path.join(
            tmpDir,
            `chunk_${String(i).padStart(4, "0")}.webm`,
          );
          const buffer = await storage.getVideoChunk(sortedChunks[i].storageKey);
          await fs.writeFile(chunkPath, buffer);
          chunkPaths.push(chunkPath);
        }
        log(
          `Screen ${screenIndex}: downloaded ${chunkPaths.length} chunks`,
          Date.now() - downloadStart,
        );

        let videoPath: string;
        if (chunkPaths.length === 1) {
          videoPath = chunkPaths[0];
        } else {
          videoPath = path.join(tmpDir, "merged.webm");
          const mergeStart = Date.now();
          log(
            `Screen ${screenIndex}: stream-merging ${chunkPaths.length} chunks...`,
          );
          await mergeLocalFilesSequential(chunkPaths, videoPath);
          log(`Screen ${screenIndex}: merge complete`, Date.now() - mergeStart);
        }

        const frames = await extractFramesFromVideoPath(
          sessionId,
          screenIndex,
          videoPath,
          realStartTime,
          keepDir,
        );
        allFrames.push(...frames);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  };

  try {
    if (mergedReady) {
      const key = (session as any).mergedVideo.storageKey as string;
      log(`Using merged video at ${key}`);

      // The eager merge covers screen 0 only; multi-monitor sessions may still
      // hold chunk references for other screens — process those as well.
      const remainingScreens = groupChunksByScreen((s) => s !== 0);
      screenCountForLog = 1 + remainingScreens.size;
      log(
        `Session start: ${new Date(realStartTime).toISOString()}; ${screenCountForLog} screen(s) (merged + ${remainingScreens.size} chunk-based)`,
      );

      const workDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `proctoring-${sessionId}-merged-`),
      );
      try {
        const videoPath = path.join(workDir, "merged.webm");
        const { pipeline } = await import("stream/promises");
        const { createWriteStream } = await import("fs");
        await pipeline(
          await storage.openReadStream(key),
          createWriteStream(videoPath),
        );
        const frames = await extractFramesFromVideoPath(
          sessionId,
          0,
          videoPath,
          realStartTime,
          keepDir,
        );
        allFrames.push(...frames);
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }

      await processChunkScreens(remainingScreens);
    } else if (!session.videoChunks?.length) {
      log("No video chunks found");
      await cleanup();
      return { frames: [], cleanup: noop };
    } else {
      const chunksByScreen = groupChunksByScreen();
      screenCountForLog = chunksByScreen.size;
      log(
        `Session start: ${new Date(realStartTime).toISOString()}; ${chunksByScreen.size} screen(s)`,
      );
      await processChunkScreens(chunksByScreen);
    }

    allFrames.sort(
      (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
    );

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "stats.videoStats.extractedFrameCount": allFrames.length,
      "stats.videoStats.extractionMethod":
        allFrames.length > 0 ? "fixed_interval" : null,
    });

    log(
      `Total: ${allFrames.length} frames from ${screenCountForLog} screen(s)`,
      Date.now() - extractStart,
    );

    return { frames: allFrames, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
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

  if (sec != null) return sec;

  console.warn(`[${new Date().toISOString()}] [videoExtractor] Could not determine video duration, defaulting to 60s`);
  return 60;
}

/** Read PNG dimensions from the file header without loading the whole image. */
async function readPngDimensionsFromFile(
  filePath: string,
): Promise<{ width: number; height: number }> {
  const fh = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(24);
    await fh.read(header, 0, 24, 0);
    return parsePngDimensions(header);
  } finally {
    await fh.close();
  }
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
