/**
 * Re-mux concatenated WebM chunks so the output has correct duration/metadata
 * for HTML5 video playback. Uses ffmpeg -c copy (no re-encode).
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const execAsync = promisify(exec);
const FFMPEG_PATH = ffmpegInstaller.path;

/** Max stderr/stdout captured from ffmpeg (log lines only; stream is file-based). */
const FFMPEG_LOG_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Re-mux a WebM file in-place on disk so the container has correct duration and seeking.
 * @returns true if output was written successfully, false if ffmpeg is unavailable or fails.
 */
export async function remuxWebMFromPaths(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  try {
    await execAsync(
      `"${FFMPEG_PATH}" -f webm -i "${inputPath}" -c copy -y "${outputPath}" 2>&1`,
      { maxBuffer: FFMPEG_LOG_MAX_BUFFER }
    );
    return true;
  } catch (err) {
    console.warn(
      `[playbackRemux] ffmpeg re-mux failed:`,
      (err as Error)?.message
    );
    return false;
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
