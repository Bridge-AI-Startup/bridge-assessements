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

/**
 * Mongo `merging` is only a live lock if THIS process is doing it, or another
 * instance claimed it moments ago. A 30-minute stale window left recordings
 * stuck after every nodemon/Render restart: waitForMergedPlayback polled the
 * dead lock, evaluation never graded, Review showed "Preparing recording…".
 * Same-process work is tracked in `inFlightMerges` (a 10-minute merge is fine).
 * Cross-instance / crash: steal after this grace.
 */
const MERGE_LOCK_GRACE_MS = 20 * 1000;
const inFlightMerges = new Set<string>();
const MAX_CONCURRENT_MERGES = Number(
  process.env.PROCTORING_VIDEO_MERGE_MAX_CONCURRENT || 2,
);

function isMissingObjectError(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; message?: string };
  const msg = e?.message ?? "";
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    (e as { code?: string })?.code === "ENOENT" ||
    /specified key does not exist|no such file/i.test(msg)
  );
}

/**
 * Yield each chunk's bytes, skipping blobs that are gone from storage.
 *
 * Mongo can hold `videoChunks` references to objects that no longer exist (an earlier
 * merge deleted the blobs without clearing the refs). Aborting the whole merge on the
 * first missing key left those sessions permanently unmerged, which meant every
 * playback request rebuilt the recording from scratch — the exact path that OOMs.
 * A partial recording beats no recording; only an all-missing set is a real failure.
 */
async function* readChunksSkippingMissing(
  chunks: { storageKey: string }[],
  storage: Pick<IFrameStorage, "getVideoChunk">,
  onDone: (stats: { read: number; missing: number }) => void,
): AsyncGenerator<Buffer> {
  let read = 0;
  let missing = 0;
  for (const c of chunks) {
    let buf: Buffer;
    try {
      buf = await storage.getVideoChunk(c.storageKey);
    } catch (err) {
      if (isMissingObjectError(err)) {
        missing += 1;
        dv("skipping missing chunk", c.storageKey);
        continue;
      }
      throw err;
    }
    read += 1;
    yield buf;
  }
  onDone({ read, missing });
  if (read === 0) {
    throw new Error(
      `all ${chunks.length} video chunk(s) missing from storage`,
    );
  }
}

let activeMerges = 0;
const mergeQueue: Array<() => void> = [];

/** In-process merge concurrency snapshot for ops dashboard (this Render instance only). */
export function getVideoMergeQueueStats(): {
  active: number;
  queued: number;
  maxConcurrent: number;
} {
  return {
    active: activeMerges,
    queued: mergeQueue.length,
    maxConcurrent: MAX_CONCURRENT_MERGES,
  };
}

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

    await appendBuffersSequential(
      readChunksSkippingMissing(chunks, storage, ({ read, missing }) => {
        dv(
          "[buildSessionWebmForPlayback] read",
          read,
          "chunk(s), skipped",
          missing,
          "missing",
        );
      }),
      mergedPath,
    );

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

function earliestScreenZeroStart(session: {
  videoChunks?: Array<{ startTime?: Date; screenIndex?: number }>;
}): Date | null {
  let min: Date | null = null;
  if (!session.videoChunks?.length) return null;
  for (const ch of session.videoChunks) {
    if ((ch.screenIndex ?? 0) !== 0) continue;
    const start = ch.startTime ? new Date(ch.startTime) : null;
    if (!start || !Number.isFinite(start.getTime())) continue;
    if (!min || start < min) min = start;
  }
  return min;
}

/** True when another merge of this session is actually running (or just claimed). */
export function mergeLockIsLive(
  mv: { status?: string; mergingStartedAt?: Date | string | null } | null | undefined,
  sessionId: string,
  now = Date.now(),
  inFlight: ReadonlySet<string> = inFlightMerges,
): boolean {
  if (mv?.status !== "merging") return false;
  if (inFlight.has(sessionId)) return true;
  if (!mv.mergingStartedAt) return false;
  const started = new Date(mv.mergingStartedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started < MERGE_LOCK_GRACE_MS;
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

    if (mergeLockIsLive(mv, sessionId)) {
      return { ok: true, skipped: "merging_in_progress" };
    }
    if (mv?.status === "merging") {
      const age = mv.mergingStartedAt
        ? Date.now() - new Date(mv.mergingStartedAt).getTime()
        : NaN;
      console.warn(
        `[sessionVideoMerge] reclaiming stale merge lock sessionId=${sessionId}` +
          (Number.isFinite(age) ? ` ageMs=${Math.round(age)}` : ""),
      );
    }

    const chunks = await resolveSessionVideoChunkKeys(sessionId, session, storage);
    if (chunks.length === 0) {
      dv("mergeSessionVideo: no chunks sessionId=", sessionId);
      return { ok: true, skipped: "no_chunks" };
    }

    const keysToDelete = chunks.map((c) => c.storageKey);
    const staleBefore = new Date(Date.now() - MERGE_LOCK_GRACE_MS);

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
    inFlightMerges.add(sessionId);
    const durationFromChunks =
      sumScreenZeroChunkDurationSeconds(session as any) ||
      (session.stats?.videoStats?.durationSeconds ?? 0);
    const captureStartFallback =
      (session.stats as { captureStartedAt?: Date | null } | undefined)
        ?.captureStartedAt || earliestScreenZeroStart(session as any);

    let tmpDir: string | undefined;
    try {
      tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `proctoring-merge-${sessionId}-`),
      );
      const mergedPath = path.join(tmpDir, "merged.webm");
      const remuxedPath = path.join(tmpDir, "remuxed.webm");
      const { appendBuffersSequential } = await import("./videoMerge.js");
      await appendBuffersSequential(
        readChunksSkippingMissing(chunks, storage, ({ read, missing }) => {
          if (missing > 0) {
            console.warn(
              `[sessionVideoMerge] sessionId=${sessionId}: merged ${read} chunk(s), skipped ${missing} missing from storage`,
            );
          }
        }),
        mergedPath,
      );
      const { remuxWebMFromPaths } = await import("./playbackRemux.js");
      const remuxOk = await remuxWebMFromPaths(mergedPath, remuxedPath);
      const finalPath = remuxOk ? remuxedPath : mergedPath;
      const finalSizeBytes = (await fs.stat(finalPath)).size;

      await storage.storeBlobFromFile(playbackKey, finalPath);

      // Point Mongo at merged file and clear chunk keys BEFORE deleting blobs so
      // concurrent transcript jobs never see chunk keys for missing objects.
      // Only the merged (screen-0) entries are pulled: other screens' chunks stay
      // referenced so multi-monitor recordings remain playable and transcribable.
      const readySet: Record<string, unknown> = {
        "mergedVideo.status": "ready",
        "mergedVideo.storageKey": playbackKey,
        "mergedVideo.sizeBytes": finalSizeBytes,
        "mergedVideo.durationSeconds": durationFromChunks,
        "mergedVideo.mergedAt": new Date(),
        "mergedVideo.chunksDeletedAt": new Date(),
        "mergedVideo.error": null,
        "mergedVideo.mergingStartedAt": null,
      };
      if (
        captureStartFallback &&
        !(session.stats as { captureStartedAt?: Date | null } | undefined)
          ?.captureStartedAt
      ) {
        readySet["stats.captureStartedAt"] = captureStartFallback;
      }
      await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
        $set: readySet,
        $pull: {
          videoChunks: { storageKey: { $in: keysToDelete } },
        },
      });

      for (const key of keysToDelete) {
        try {
          await storage.delete(key);
        } catch {
          /* ignore */
        }
      }

      const submissionId = (session as { submissionId?: { toString(): string } })
        .submissionId?.toString();
      if (submissionId) {
        // Surface-identify the Review movie (LOW / 1fps), not OCR. Fire-and-
        // forget: merge must not wait on Gemini.
        void import("../workflowCapture/screenContext.js").then((m) =>
          m.classifyAfterProctoringMerge(submissionId),
        );
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
      inFlightMerges.delete(sessionId);
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
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

/** Reclaim `merging` locks left behind by a process restart. */
export async function resumeInterruptedMerges(): Promise<void> {
  const stuck = await ProctoringSessionModel.find({
    "mergedVideo.status": "merging",
    status: { $in: ["completed", "failed"] },
  })
    .select("_id")
    .limit(25)
    .lean();
  if (stuck.length === 0) return;
  console.log(
    `[sessionVideoMerge] resuming ${stuck.length} merge(s) interrupted by a process restart`,
  );
  for (const s of stuck) {
    mergeSessionVideoInBackground(String(s._id));
  }
}

const MERGE_WAIT_MS = 10 * 60 * 1000;
const MERGE_POLL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until screen-0 playback.webm exists (or merge is impossible).
 * Used by workflow evaluation so screen classification can run before episodes.
 */
export async function waitForMergedPlayback(
  sessionId: string,
  timeoutMs = MERGE_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await ProctoringSessionModel.findById(sessionId)
      .select("mergedVideo")
      .lean();
    if (!session) return false;
    const mv = (
      session as {
        mergedVideo?: { status?: string; storageKey?: string | null };
      }
    ).mergedVideo;
    if (mv?.status === "ready" && mv.storageKey) {
      if (await getFrameStorage().exists(mv.storageKey)) return true;
    }
    if (mv?.status === "failed") return false;
    const result = await mergeSessionVideo(sessionId);
    if (result.skipped === "no_session" || result.skipped === "no_chunks") {
      return false;
    }
    if (result.ok && (!result.skipped || result.skipped === "already_ready")) {
      return true;
    }
    if (!result.ok && result.error) return false;
    await sleep(MERGE_POLL_MS);
  }
  return false;
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

/**
 * End screen capture for a submission and start the merge.
 * Idempotent: a client `POST /complete` may have already marked the session done.
 * Every submit / opt-out / recording-only path should call this so a tab that
 * never reached `completeSession` cannot keep uploading chunks.
 */
export async function completeProctoringForSubmission(
  submissionId: string,
): Promise<void> {
  await ProctoringSessionModel.updateOne(
    {
      submissionId,
      status: { $nin: ["completed", "failed"] },
    },
    {
      $set: {
        status: "completed",
        "stats.captureEndedAt": new Date(),
      },
    },
  );
  await mergeProctoringVideoForSubmission(submissionId);
}
