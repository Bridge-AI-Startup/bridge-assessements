/**
 * Eager merge of MediaRecorder WebM chunks into one remuxed file at `{sessionId}/playback.webm`,
 * then delete chunk objects. Idempotent; concurrent merges limited via in-process queue.
 */
import path from "path";
import os from "os";
import fs from "fs/promises";

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage, type IFrameStorage } from "./storage.js";

const DEBUG_MERGE = process.env.PROCTORING_VIDEO_MERGE_DEBUG === "1";
const dv = (...args: unknown[]) => {
  if (DEBUG_MERGE) console.log("[sessionVideoMerge]", ...args);
};

export function mergedPlaybackStorageKey(sessionId: string): string {
  return `${sessionId}/playback.webm`;
}

const MERGING_STALE_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_MERGES = Number(
  process.env.PROCTORING_VIDEO_MERGE_MAX_CONCURRENT || 2,
);

let activeMerges = 0;
const mergeQueue: Array<() => void> = [];

async function withMergeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeMerges >= MAX_CONCURRENT_MERGES) {
    await new Promise<void>((resolve) => mergeQueue.push(resolve));
  }
  activeMerges += 1;
  try {
    return await fn();
  } finally {
    activeMerges -= 1;
    const next = mergeQueue.shift();
    if (next) next();
  }
}

/** Resolve ordered list of video chunk storage keys for a session (screen 0). */
export async function resolveSessionVideoChunkKeys(
  sessionId: string,
  session: { videoChunks?: unknown[] } | null,
  storage: Pick<IFrameStorage, "listKeys" | "getVideoChunk">,
): Promise<{ storageKey: string }[]> {
  let chunks: { storageKey: string }[] = [];
  dv(
    "[resolveSessionVideoChunkKeys] sessionId =",
    sessionId,
    "session?.videoChunks?.length =",
    session?.videoChunks?.length ?? 0,
  );

  if (session?.videoChunks?.length) {
    const byScreen = new Map<number, { storageKey: string; startTime: Date }[]>();
    for (const ch of session.videoChunks as {
      storageKey: string;
      startTime: Date;
      screenIndex?: number;
    }[]) {
      const screenIndex = ch.screenIndex ?? 0;
      if (!byScreen.has(screenIndex)) byScreen.set(screenIndex, []);
      byScreen.get(screenIndex)!.push({
        storageKey: ch.storageKey,
        startTime: new Date(ch.startTime),
      });
    }
    const screen0 =
      byScreen.get(0) ?? byScreen.get(Math.min(...byScreen.keys()));
    if (screen0) {
      screen0.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      chunks = screen0;
    }
    dv(
      "[resolveSessionVideoChunkKeys] from DB: chunk count =",
      chunks.length,
    );
  }

  if (chunks.length === 0) {
    const prefix = `${sessionId}/video`;
    const keys = await storage.listKeys(prefix);
    const webmKeys = keys.filter((k) => k.endsWith(".webm"));
    dv(
      "[resolveSessionVideoChunkKeys] listKeys webm count =",
      webmKeys.length,
    );
    if (webmKeys.length === 0) return [];
    const withMeta = webmKeys.map((key) => {
      const name = key.split("/").pop() || "";
      const [tsStr, screenStr] = name.replace(".webm", "").split("-");
      return {
        storageKey: key,
        ts: parseInt(tsStr, 10) || 0,
        screenIndex: parseInt(screenStr, 10) || 0,
      };
    });
    const screen0Keys = withMeta.filter((m) => m.screenIndex === 0);
    const toUse = screen0Keys.length ? screen0Keys : withMeta;
    toUse.sort((a, b) => a.ts - b.ts);
    chunks = toUse.map((m) => ({ storageKey: m.storageKey }));
  }

  return chunks;
}

/**
 * Merge session video chunks to a temp file and optionally remux with ffmpeg.
 * Caller must await `cleanup()` after streaming finishes.
 */
export async function buildSessionWebmForPlayback(
  sessionId: string,
  session: { videoChunks?: unknown[] } | null,
  storage: Pick<IFrameStorage, "listKeys" | "getVideoChunk">,
): Promise<{ filePath: string; cleanup: () => Promise<void>; remuxed: boolean } | null> {
  dv("[buildSessionWebmForPlayback] sessionId =", sessionId);
  const chunks = await resolveSessionVideoChunkKeys(sessionId, session, storage);
  if (chunks.length === 0) {
    dv("[buildSessionWebmForPlayback] no chunks resolved, returning null");
    return null;
  }
  dv("[buildSessionWebmForPlayback] merging", chunks.length, "chunks");

  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `proctoring-playback-${sessionId}-`),
  );
  const mergedPath = path.join(tmpDir, "merged.webm");
  const remuxedPath = path.join(tmpDir, "remuxed.webm");

  const cleanup = async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const { appendBuffersSequential } = await import("./videoMerge.js");

    async function* chunkBuffers(): AsyncGenerator<Buffer> {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const buf = await storage.getVideoChunk(c.storageKey);
        dv(
          "[buildSessionWebmForPlayback] chunk",
          i + 1,
          "/",
          chunks.length,
          "size =",
          buf.length,
        );
        yield buf;
      }
    }

    await appendBuffersSequential(chunkBuffers(), mergedPath);

    const { remuxWebMFromPaths } = await import("./playbackRemux.js");
    const remuxOk = await remuxWebMFromPaths(mergedPath, remuxedPath);
    dv("[buildSessionWebmForPlayback] remuxOk =", remuxOk);

    return {
      filePath: remuxOk ? remuxedPath : mergedPath,
      cleanup,
      remuxed: remuxOk,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function sumScreenZeroChunkDurationSeconds(session: {
  videoChunks?: Array<{ startTime?: Date; endTime?: Date | null; screenIndex?: number }>;
}): number {
  let total = 0;
  if (!session.videoChunks?.length) return 0;
  for (const ch of session.videoChunks) {
    if ((ch.screenIndex ?? 0) !== 0) continue;
    const start = ch.startTime ? new Date(ch.startTime).getTime() : NaN;
    const end = (
      ch.endTime ? new Date(ch.endTime) : ch.startTime ? new Date(ch.startTime) : null
    )?.getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      total += (end - start) / 1000;
    }
  }
  return total;
}

export type MergeSessionVideoResult = {
  ok: boolean;
  skipped?: string;
  error?: string;
};

/**
 * Merge screen-0 chunks into `playback.webm`, delete chunk blobs, clear `videoChunks` in Mongo.
 * Safe to call multiple times (idempotent).
 */
export async function mergeSessionVideo(
  sessionId: string,
): Promise<MergeSessionVideoResult> {
  return withMergeSlot(async () => {
    const storage = getFrameStorage();
    let session = await ProctoringSessionModel.findById(sessionId);
    if (!session) return { ok: false, skipped: "no_session" };

    const playbackKey = mergedPlaybackStorageKey(sessionId);
    const mv = session.mergedVideo as
      | {
          status?: string;
          storageKey?: string | null;
          mergingStartedAt?: Date | null;
        }
      | undefined;

    if (
      mv?.status === "ready" &&
      mv.storageKey &&
      (await storage.exists(mv.storageKey))
    ) {
      return { ok: true, skipped: "already_ready" };
    }

    if (mv?.status === "merging" && mv.mergingStartedAt) {
      const age = Date.now() - new Date(mv.mergingStartedAt).getTime();
      if (age < MERGING_STALE_MS) {
        return { ok: true, skipped: "merging_in_progress" };
      }
    }

    const chunks = await resolveSessionVideoChunkKeys(sessionId, session, storage);
    if (chunks.length === 0) {
      dv("mergeSessionVideo: no chunks sessionId=", sessionId);
      return { ok: true, skipped: "no_chunks" };
    }

    const keysToDelete = chunks.map((c) => c.storageKey);
    const staleBefore = new Date(Date.now() - MERGING_STALE_MS);

    const claimed = await ProctoringSessionModel.findOneAndUpdate(
      {
        _id: sessionId,
        $or: [
          { mergedVideo: { $exists: false } },
          { "mergedVideo.status": { $in: ["not_started", "failed"] } },
          {
            "mergedVideo.status": "merging",
            $or: [
              { "mergedVideo.mergingStartedAt": { $exists: false } },
              { "mergedVideo.mergingStartedAt": null },
              { "mergedVideo.mergingStartedAt": { $lt: staleBefore } },
            ],
          },
        ],
      },
      {
        $set: {
          "mergedVideo.status": "merging",
          "mergedVideo.mergingStartedAt": new Date(),
          "mergedVideo.error": null,
        },
      },
      { new: true },
    );

    if (!claimed) {
      return { ok: true, skipped: "claim_lost" };
    }

    session = claimed;
    const durationFromChunks =
      sumScreenZeroChunkDurationSeconds(session as any) ||
      (session.stats?.videoStats?.durationSeconds ?? 0);

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `proctoring-merge-${sessionId}-`),
    );
    const mergedPath = path.join(tmpDir, "merged.webm");
    const remuxedPath = path.join(tmpDir, "remuxed.webm");

    try {
      const { appendBuffersSequential } = await import("./videoMerge.js");
      async function* chunkBuffers(): AsyncGenerator<Buffer> {
        for (const c of chunks) {
          yield await storage.getVideoChunk(c.storageKey);
        }
      }
      await appendBuffersSequential(chunkBuffers(), mergedPath);
      const { remuxWebMFromPaths } = await import("./playbackRemux.js");
      const remuxOk = await remuxWebMFromPaths(mergedPath, remuxedPath);
      const finalPath = remuxOk ? remuxedPath : mergedPath;
      const finalBuf = await fs.readFile(finalPath);

      await storage.storeVideoChunk(playbackKey, finalBuf);

      // Point Mongo at merged file and clear chunk keys BEFORE deleting blobs so
      // concurrent transcript jobs never see chunk keys for missing objects.
      await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
        $set: {
          videoChunks: [],
          "mergedVideo.status": "ready",
          "mergedVideo.storageKey": playbackKey,
          "mergedVideo.sizeBytes": finalBuf.length,
          "mergedVideo.durationSeconds": durationFromChunks,
          "mergedVideo.mergedAt": new Date(),
          "mergedVideo.chunksDeletedAt": new Date(),
          "mergedVideo.error": null,
          "mergedVideo.mergingStartedAt": null,
        },
      });

      for (const key of keysToDelete) {
        try {
          await storage.delete(key);
        } catch {
          /* ignore */
        }
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sessionVideoMerge] merge failed sessionId=${sessionId}:`, err);
      await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
        $set: {
          "mergedVideo.status": "failed",
          "mergedVideo.error": msg,
          "mergedVideo.mergingStartedAt": null,
        },
      });
      return { ok: false, error: msg };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export function mergeSessionVideoInBackground(sessionId: string): void {
  mergeSessionVideo(sessionId).catch((err) =>
    console.error(
      `[sessionVideoMerge] background merge failed sessionId=${sessionId}:`,
      err,
    ),
  );
}

/** Fire-and-forget merge when a submission finishes (submit / upload / safety net). */
export async function mergeProctoringVideoForSubmission(
  submissionId: string,
): Promise<void> {
  const session = await ProctoringSessionModel.findOne({
    submissionId,
  });
  if (!session) return;
  mergeSessionVideoInBackground(session._id.toString());
}
