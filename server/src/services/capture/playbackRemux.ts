/**
 * Re-mux concatenated WebM chunks so the output has correct duration/metadata
 * for HTML5 video playback. Uses ffmpeg -c copy (no re-encode).
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const execAsync = promisify(exec);
const FFMPEG_PATH = ffmpegInstaller.path;

/** Max stderr/stdout captured from ffmpeg (log lines only; stream is file-based). */
const FFMPEG_LOG_MAX_BUFFER = 10 * 1024 * 1024;

/** EBML header magic — starts every standalone WebM (each MediaRecorder start). */
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/**
 * Byte offsets of every EBML header in the file, found with a streamed scan
 * (video files are never held whole in RAM). One offset = a single recording;
 * more = a byte-concat of several MediaRecorder sessions.
 */
export async function findEbmlHeaderOffsets(filePath: string): Promise<number[]> {
  const offsets: number[] = [];
  const stream = createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 });
  let carry = Buffer.alloc(0);
  let base = 0;
  for await (const chunk of stream) {
    const buf = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    let idx = buf.indexOf(EBML_MAGIC);
    while (idx !== -1) {
      offsets.push(base - carry.length + idx);
      idx = buf.indexOf(EBML_MAGIC, idx + 1);
    }
    // Keep a 3-byte tail so magic straddling a chunk boundary is still found.
    carry = buf.subarray(Math.max(0, buf.length - (EBML_MAGIC.length - 1)));
    base += (chunk as Buffer).length;
  }
  return offsets;
}

async function copyByteRange(
  srcPath: string,
  destPath: string,
  start: number,
  endExclusive: number
): Promise<void> {
  await pipeline(
    createReadStream(srcPath, { start, end: endExclusive - 1 }),
    createWriteStream(destPath)
  );
}

/**
 * Re-mux a WebM file in-place on disk so the container has correct duration and seeking.
 *
 * A recording is often a byte-concat of SEVERAL MediaRecorder sessions (the
 * recorder restarts on stream re-share), each with its own EBML header and
 * timestamps starting back at 0. Plain `-c copy` on that concat dies with
 * "non monotonically increasing dts" and the merge used to fall back to the
 * raw concat — a file with no duration and no Cues, which the review player
 * cannot seek (an evidence-chip jump stalls on a black frame forever). So:
 * split at EBML header boundaries and feed the segments to ffmpeg's concat
 * demuxer, which re-stamps timestamps monotonically across segments.
 *
 * @returns true if output was written successfully, false if ffmpeg is unavailable or fails.
 */
export async function remuxWebMFromPaths(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  try {
    const offsets = await findEbmlHeaderOffsets(inputPath);
    if (offsets.length <= 1) {
      await execAsync(
        `"${FFMPEG_PATH}" -f webm -i "${inputPath}" -c copy -y "${outputPath}" 2>&1`,
        { maxBuffer: FFMPEG_LOG_MAX_BUFFER }
      );
      return true;
    }
    return await remuxSegmentedWebM(inputPath, outputPath, offsets);
  } catch (err) {
    console.warn(
      `[playbackRemux] ffmpeg re-mux failed:`,
      (err as Error)?.message
    );
    return false;
  }
}

/** Split a multi-header concat into segment files and concat-demux them. */
async function remuxSegmentedWebM(
  inputPath: string,
  outputPath: string,
  offsets: number[]
): Promise<boolean> {
  const { size: totalBytes } = await fs.stat(inputPath);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proctoring-segs-"));
  try {
    const listLines: string[] = [];
    for (let i = 0; i < offsets.length; i++) {
      const start = offsets[i];
      const end = i + 1 < offsets.length ? offsets[i + 1] : totalBytes;
      if (end <= start) continue;
      const segPath = path.join(tmpDir, `seg${i}.webm`);
      await copyByteRange(inputPath, segPath, start, end);
      listLines.push(`file '${segPath}'`);
    }
    const listPath = path.join(tmpDir, "list.txt");
    await fs.writeFile(listPath, listLines.join("\n") + "\n", "utf-8");
    await execAsync(
      `"${FFMPEG_PATH}" -f concat -safe 0 -i "${listPath}" -c copy -y "${outputPath}" 2>&1`,
      { maxBuffer: FFMPEG_LOG_MAX_BUFFER }
    );
    return true;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @deprecated Prefer remuxWebMFromPaths + streaming I/O. Loads entire file into memory.
 */
export async function remuxWebM(mergedBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proctoring-remux-"));
  const inputPath = path.join(tmpDir, "input.webm");
  const outputPath = path.join(tmpDir, "output.webm");

  try {
    await fs.writeFile(inputPath, mergedBuffer);
    const ok = await remuxWebMFromPaths(inputPath, outputPath);
    if (!ok) return null;
    return await fs.readFile(outputPath);
  } catch (err) {
    console.warn(
      `[playbackRemux] remuxWebM(buffer) failed:`,
      (err as Error)?.message
    );
    return null;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
