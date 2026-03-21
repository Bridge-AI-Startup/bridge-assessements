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

/**
 * Re-mux a raw concatenated WebM buffer (e.g. from MediaRecorder timeslice chunks)
 * so the container has correct duration and seeking. Returns the re-muxed buffer,
 * or null if ffmpeg is unavailable or fails (caller should fall back to raw concat).
 */
export async function remuxWebM(mergedBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proctoring-remux-"));
  const inputPath = path.join(tmpDir, "input.webm");
  const outputPath = path.join(tmpDir, "output.webm");

  try {
    await fs.writeFile(inputPath, mergedBuffer);
    await execAsync(
      `"${FFMPEG_PATH}" -f webm -i "${inputPath}" -c copy -y "${outputPath}" 2>&1`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    const out = await fs.readFile(outputPath);
    return out;
  } catch (err) {
    console.warn(
      `[playbackRemux] ffmpeg re-mux failed, playback will use raw concat:`,
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
