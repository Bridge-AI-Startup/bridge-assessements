/**
 * Screen recording attached to a workflow capture session.
 *
 * On `both`, the Review movie is the proctoring merged `playback.webm` — this
 * kit recording is not started. These endpoints remain for the local tester
 * (unlinked sessions). Kit video is never OCR'd.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

import { WorkflowCaptureSessionModel } from "../../models/workflowCapture.js";
import { getFrameStorage } from "../capture/storage.js";
import { mergeLocalFilesSequential } from "../capture/videoMerge.js";
import { remuxWebMFromPaths } from "../capture/playbackRemux.js";
import { getVideoDurationSeconds } from "../capture/videoFrameExtractor.js";

/**
 * Join separately-recorded WebM streams into one timeline using ffmpeg's concat
 * demuxer. Byte-appending them does not work: each is a complete stream with its
 * own header, and players stop at the end of the first.
 */
async function concatWebMFiles(
  files: string[],
  outPath: string,
  workDir: string
): Promise<void> {
  const listPath = path.join(workDir, "concat.txt");
  await fs.writeFile(
    listPath,
    files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
  );
  const ffmpeg = (await import("@ffmpeg-installer/ffmpeg")).default.path;
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  await promisify(execFile)(
    ffmpeg,
    ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", outPath],
    { maxBuffer: 32 * 1024 * 1024 }
  );
}

export function videoChunkKey(sessionId: string, index: number): string {
  return `workflow-capture/${sessionId}/video/${String(index).padStart(6, "0")}.webm`;
}

export function mergedVideoKey(sessionId: string): string {
  return `workflow-capture/${sessionId}/playback.webm`;
}

/**
 * Produce a seekable WebM for playback.
 *
 * MediaRecorder chunks concatenated raw have no cues, so a browser can play
 * them but cannot seek — which would defeat the entire point of a timeline you
 * click to jump. We therefore remux through ffmpeg and cache the result.
 */
export async function buildPlaybackVideo(
  sessionId: string
): Promise<{ key: string; sizeBytes: number } | null> {
  const storage = getFrameStorage();
  const session: any = await WorkflowCaptureSessionModel.findById(sessionId).lean();
  if (!session) return null;

  const existing = session.video?.mergedKey;
  if (existing && (await storage.exists(existing))) {
    // Size is cached on the session so playback needs no stat/headObject —
    // the shared storage interface has no size call and proctoring depends on it.
    return { key: existing, sizeBytes: session.video?.mergedSizeBytes ?? 0 };
  }

  const chunks = [...(session.video?.chunks ?? [])].sort(
    (a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  if (chunks.length === 0) return null;

  const segments = (session.video?.segments ?? []) as any[];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `wfc-video-${sessionId}-`));
  try {
    // Chunks within ONE segment are MediaRecorder fragments: the first carries
    // the header and the rest are continuations, so byte-appending them is
    // correct. Across segments it is NOT — each resume starts a fresh
    // MediaRecorder with its own header, and byte-appending two complete WebM
    // streams yields a file players read as just the first one. So: byte-append
    // within a segment, then concat segments at the container level.
    const groups: string[][] = [];
    if (segments.length <= 1) {
      groups.push(chunks.map((c: any) => c.storageKey));
    } else {
      const bounds = segments.map((s: any) => ({
        start: new Date(s.wallStartedAt).getTime(),
        end: s.wallEndedAt ? new Date(s.wallEndedAt).getTime() : Infinity,
      }));
      const buckets: string[][] = bounds.map(() => []);
      for (const c of chunks as any[]) {
        const t = new Date(c.startTime).getTime();
        // Chunks are stamped on arrival, so a chunk can land just after its
        // segment closed; attribute to the last segment that had started.
        let idx = bounds.findIndex((b) => t >= b.start && t <= b.end);
        if (idx === -1) {
          idx = bounds.reduce((best, b, i) => (t >= b.start ? i : best), 0);
        }
        buckets[idx].push(c.storageKey);
      }
      for (const b of buckets) if (b.length) groups.push(b);
    }

    const segmentFiles: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      const localPaths: string[] = [];
      for (let i = 0; i < groups[g].length; i++) {
        try {
          const buf = await storage.getVideoChunk(groups[g][i]);
          const p = path.join(tmpDir, `s${g}_c${String(i).padStart(5, "0")}.webm`);
          await fs.writeFile(p, buf);
          localPaths.push(p);
        } catch {
          // A missing blob must not sink the whole recording.
        }
      }
      if (localPaths.length === 0) continue;

      const segRaw = path.join(tmpDir, `seg${g}.webm`);
      if (localPaths.length === 1) await fs.copyFile(localPaths[0], segRaw);
      else await mergeLocalFilesSequential(localPaths, segRaw);

      // Remux each segment on its own so it becomes a well-formed, seekable
      // stream before we concatenate.
      const segFixed = path.join(tmpDir, `seg${g}-fixed.webm`);
      const ok = await remuxWebMFromPaths(segRaw, segFixed);
      segmentFiles.push(ok ? segFixed : segRaw);
    }
    if (segmentFiles.length === 0) return null;

    // Correct each segment's start offset from the REAL duration of the video
    // before it. Wall-clock duration is not the same thing — MediaRecorder
    // drops the tail of a timeslice on stop, and the stop/flush round-trip adds
    // seconds that were never recorded. Using wall-clock here would send a
    // reviewer to the wrong moment for every event after a resume.
    const measured: number[] = [];
    let running = 0;
    for (const f of segmentFiles) {
      measured.push(Number(running.toFixed(2)));
      try {
        running += await getVideoDurationSeconds(f);
      } catch {
        // Unmeasurable segment: fall back to leaving the offset where it was.
      }
    }
    if (groups.length === measured.length && segments.length) {
      const $set: Record<string, number> = {};
      for (let i = 0; i < measured.length && i < segments.length; i++) {
        $set[`video.segments.${i}.videoOffsetStart`] = measured[i];
      }
      await WorkflowCaptureSessionModel.updateOne({ _id: sessionId }, { $set });
    }

    let finalPath: string;
    if (segmentFiles.length === 1) {
      finalPath = segmentFiles[0];
    } else {
      finalPath = path.join(tmpDir, "playback.webm");
      await concatWebMFiles(segmentFiles, finalPath, tmpDir);
    }

    const key = mergedVideoKey(sessionId);
    await storage.storeBlobFromFile(key, finalPath);
    const sizeBytes = (await fs.stat(finalPath)).size;
    await WorkflowCaptureSessionModel.updateOne(
      { _id: sessionId },
      {
        $set: {
          "video.mergedKey": key,
          "video.mergedSizeBytes": sizeBytes,
          "video.status": "ready",
        },
      }
    );
    return { key, sizeBytes };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface VideoSegment {
  wallStartedAt: Date | string;
  wallEndedAt?: Date | string | null;
  videoOffsetStart: number;
}

/**
 * Where a segment should begin in the merged video: the total recorded duration
 * of everything before it. Gaps between segments occupy no video time, which is
 * exactly why a naive `at - startedAt` breaks once recording has been resumed.
 */
export function nextVideoOffsetStart(segments: VideoSegment[]): number {
  let total = 0;
  for (const s of segments) {
    if (!s.wallEndedAt) continue;
    const start = new Date(s.wallStartedAt).getTime();
    const end = new Date(s.wallEndedAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      total += (end - start) / 1000;
    }
  }
  return Number(total.toFixed(2));
}

/**
 * Offset (seconds) of a wall-clock instant into the merged recording, or null
 * when the instant falls in no segment — i.e. before recording began, after it
 * ended, or inside a gap where the share was interrupted.
 *
 * Returning null rather than clamping matters: an event with no footage should
 * say so, not silently seek the reviewer to an unrelated moment.
 */
export function offsetIntoVideo(
  at: Date | string,
  segments: VideoSegment[] | null | undefined
): number | null {
  if (!segments?.length) return null;
  const atMs = new Date(at).getTime();
  if (!Number.isFinite(atMs)) return null;

  for (const seg of segments) {
    const startMs = new Date(seg.wallStartedAt).getTime();
    if (!Number.isFinite(startMs) || atMs < startMs) continue;
    // An open segment (still recording) extends to now.
    const endMs = seg.wallEndedAt ? new Date(seg.wallEndedAt).getTime() : Date.now();
    if (!Number.isFinite(endMs) || atMs > endMs) continue;
    const withinSegment = (atMs - startMs) / 1000;
    return Number((seg.videoOffsetStart + withinSegment).toFixed(2));
  }
  return null;
}
