/**
 * Retroactively merge per-chunk WebM files in storage (S3 or local) into
 * `{sessionId}/playback.webm` and set `mergedVideo` on ProctoringSession documents.
 *
 * Finds:
 * 1. Sessions with `videoChunks` in Mongo but not merged (or merge failed).
 * 2. Completed sessions with empty `videoChunks` in Mongo — still calls merge, which
 *    uses `listKeys(sessionId/video)` so orphaned S3-only chunks are picked up.
 * 3. Sessions marked `mergedVideo.status: ready` but missing `playback.webm` in storage
 *    — resets merge state then re-runs merge if chunk objects still exist.
 *
 * Usage (from server/, with config.env — same Atlas + S3 as production API):
 *   npx tsx src/scripts/backfillMergedProctoringVideos.ts --dry-run
 *   npx tsx src/scripts/backfillMergedProctoringVideos.ts
 *   npx tsx src/scripts/backfillMergedProctoringVideos.ts --session=64a1b2c3d4e5f6789012345
 *   npx tsx src/scripts/backfillMergedProctoringVideos.ts --limit=50
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import { mergeSessionVideo, mergedPlaybackStorageKey } from "../services/capture/sessionVideoMerge.js";
import { getFrameStorage } from "../services/capture/storage.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  sessionId: string | null;
  limit: number | null;
} {
  let dryRun = false;
  let sessionId: string | null = null;
  let limit: number | null = null;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    if (a.startsWith("--session=")) sessionId = a.slice("--session=".length).trim() || null;
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { dryRun, sessionId, limit };
}

async function collectCandidateSessionIds(): Promise<string[]> {
  const storage = getFrameStorage();

  const query = {
    $or: [
      {
        $and: [
          { "videoChunks.0": { $exists: true } },
          {
            $or: [
              { mergedVideo: { $exists: false } },
              { "mergedVideo.status": { $ne: "ready" } },
            ],
          },
        ],
      },
      {
        $and: [
          { status: "completed" },
          {
            $or: [
              { videoChunks: { $exists: false } },
              { videoChunks: { $size: 0 } },
            ],
          },
          {
            $or: [
              { mergedVideo: { $exists: false } },
              { "mergedVideo.status": { $in: ["not_started", "failed", "merging"] } },
            ],
          },
        ],
      },
    ],
  };

  const docs = await ProctoringSessionModel.find(query)
    .select("_id mergedVideo")
    .lean();

  const ids = [...new Set(docs.map((d: any) => d._id.toString()))];

  /** Ready in DB but object missing — allow re-merge after reset. */
  const brokenReady = await ProctoringSessionModel.find({
    "mergedVideo.status": "ready",
    "mergedVideo.storageKey": { $type: "string", $nin: [null, ""] },
  })
    .select("_id mergedVideo")
    .lean();

  for (const d of brokenReady) {
    const id = (d as any)._id.toString();
    const key =
      (d as any).mergedVideo?.storageKey || mergedPlaybackStorageKey(id);
    const exists = await storage.exists(key);
    if (!exists && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

async function main() {
  const { dryRun, sessionId, limit } = parseArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`backfillMergedProctoringVideos — merge legacy WebM chunks → playback.webm

Options:
  --dry-run              List session IDs only (no writes)
  --session=MONGO_ID     Process a single session
  --limit=N              Max sessions to process (after --session, limit applies to list)

Requires: ATLAS_URI (via config), proctoring storage env (S3 or local) same as API.
`);
    process.exit(0);
  }

  await connectMongoose();
  const storage = getFrameStorage();

  let ids: string[];
  if (sessionId) {
    ids = [sessionId];
  } else {
    ids = await collectCandidateSessionIds();
  }

  if (limit != null && ids.length > limit) {
    ids = ids.slice(0, limit);
  }

  console.log(
    `Processing ${ids.length} session(s) (storage=${process.env.PROCTORING_STORAGE_BACKEND || (process.env.PROCTORING_S3_BUCKET || process.env.AWS_S3_BUCKET ? "s3" : "local")})`,
  );

  let merged = 0;
  let skipped = 0;
  let dryListed = 0;
  let resetBroken = 0;

  for (const id of ids) {
    if (dryRun) {
      const s = await ProctoringSessionModel.findById(id).select("videoChunks mergedVideo status").lean();
      const chunkN = (s as any)?.videoChunks?.length ?? 0;
      const prefix = `${id}/video`;
      const keys = await storage.listKeys(prefix);
      const webmN = keys.filter((k) => k.endsWith(".webm")).length;
      console.log(
        `[dry-run] ${id} status=${(s as any)?.status} mongoChunks=${chunkN} storageWebm=${webmN} merged=${(s as any)?.mergedVideo?.status ?? "n/a"}`,
      );
      dryListed++;
      continue;
    }

    const playbackKey = mergedPlaybackStorageKey(id);
    const before = await ProctoringSessionModel.findById(id).select("mergedVideo").lean();
    const mv = (before as any)?.mergedVideo;
    if (mv?.status === "ready" && mv?.storageKey) {
      const ok = await storage.exists(mv.storageKey);
      if (!ok) {
        await ProctoringSessionModel.updateOne(
          { _id: id },
          {
            $set: {
              "mergedVideo.status": "not_started",
              "mergedVideo.storageKey": null,
              "mergedVideo.error": "backfill: ready but object missing, reset for re-merge",
            },
          },
        );
        resetBroken++;
        console.log(`[reset] ${id}: mergedVideo was ready but ${playbackKey} missing — reset for re-merge`);
      }
    }

    const r = await mergeSessionVideo(id);
    console.log(`${id}:`, r);
    if (r.ok && !r.skipped) merged++;
    else skipped++;
  }

  console.log(
    dryRun
      ? `Done. listed=${dryListed} (dry-run, no writes)`
      : `Done. merged=${merged} skipped_or_noop=${skipped}${resetBroken ? ` broken_ready_reset=${resetBroken}` : ""}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
