/**
 * Repair already-merged `{sessionId}/playback.webm` files that shipped as raw
 * byte-concats (no duration, no Cues — the review player cannot seek them, so
 * an evidence-chip jump stalls on a black frame).
 *
 * Why they exist: a recording is often several MediaRecorder sessions back to
 * back; `ffmpeg -c copy` on their byte-concat fails with non-monotonic dts, and
 * the merge used to upload the raw concat as the fallback. `remuxWebMFromPaths`
 * now splits at EBML header boundaries and concat-demuxes, so re-running it on
 * the stored file fixes seeking without touching the (already deleted) chunks.
 *
 * For each `mergedVideo.status: "ready"` session: download playback.webm,
 * count EBML headers / Cues; if broken, remux, verify the output, back up the
 * original to `{sessionId}/playback-preremux.webm`, then overwrite. The backup
 * is kept (the chunks are gone — playback.webm is the only copy of the
 * recording); delete the backups manually once repaired files are verified.
 *
 * Usage (from server/, same Atlas + storage env as the API):
 *   npx tsx src/scripts/repairMergedPlaybackVideos.ts --dry-run
 *   npx tsx src/scripts/repairMergedPlaybackVideos.ts --apply
 *   npx tsx src/scripts/repairMergedPlaybackVideos.ts --apply --session=64a1...
 *   npx tsx src/scripts/repairMergedPlaybackVideos.ts --apply --limit=20
 */

import "../config/loadEnv.js";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import {
  remuxWebMFromPaths,
  findEbmlHeaderOffsets,
} from "../services/capture/playbackRemux.js";
import { getFrameStorage } from "../services/capture/storage.js";

const CUES_ID = Buffer.from([0x1c, 0x53, 0xbb, 0x6b]);

function parseArgs(argv: string[]): {
  apply: boolean;
  sessionId: string | null;
  limit: number | null;
} {
  let apply = false;
  let sessionId: string | null = null;
  let limit: number | null = null;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    if (a.startsWith("--session=")) sessionId = a.slice("--session=".length).trim() || null;
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { apply, sessionId, limit };
}

/** Streamed scan: does the file contain a Cues element? (4-byte id, tail overlap kept.) */
async function fileHasCues(filePath: string): Promise<boolean> {
  const { createReadStream } = await import("fs");
  const stream = createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 });
  let carry = Buffer.alloc(0);
  for await (const chunk of stream) {
    const buf = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    if (buf.includes(CUES_ID)) {
      stream.destroy();
      return true;
    }
    carry = buf.subarray(Math.max(0, buf.length - (CUES_ID.length - 1)));
  }
  return false;
}

async function main() {
  const { apply, sessionId, limit } = parseArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`repairMergedPlaybackVideos — make stored playback.webm files seekable

Options:
  --dry-run              (default) Report which recordings are broken, no writes
  --apply                Remux + overwrite broken files (original kept at playback-preremux.webm)
  --session=MONGO_ID     Process a single proctoring session
  --limit=N              Max sessions to process
`);
    process.exit(0);
  }

  await connectMongoose();
  const storage = getFrameStorage();

  let sessions: { id: string; storageKey: string }[];
  if (sessionId) {
    const doc = await ProctoringSessionModel.findById(sessionId)
      .select("mergedVideo")
      .lean();
    const key = (doc as any)?.mergedVideo?.storageKey;
    if (!key) {
      console.error(`Session ${sessionId} has no mergedVideo.storageKey`);
      process.exit(1);
    }
    sessions = [{ id: sessionId, storageKey: key }];
  } else {
    const docs = await ProctoringSessionModel.find({
      "mergedVideo.status": "ready",
      "mergedVideo.storageKey": { $type: "string", $nin: [null, ""] },
    })
      .select("_id mergedVideo.storageKey")
      .sort({ updatedAt: -1 })
      .lean();
    sessions = docs.map((d: any) => ({
      id: d._id.toString(),
      storageKey: d.mergedVideo.storageKey,
    }));
  }

  if (limit != null && sessions.length > limit) sessions = sessions.slice(0, limit);

  console.log(
    `${apply ? "Repairing" : "Checking (dry-run)"} ${sessions.length} merged recording(s)`,
  );

  let broken = 0;
  let repaired = 0;
  let healthy = 0;
  let missing = 0;
  let failed = 0;

  for (const { id, storageKey } of sessions) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `repair-playback-${id}-`));
    try {
      const inputPath = path.join(tmpDir, "playback.webm");
      let readStream;
      try {
        readStream = await storage.openReadStream(storageKey);
        await pipeline(readStream, createWriteStream(inputPath));
      } catch {
        console.log(`[missing] ${id}: ${storageKey} not readable from storage`);
        missing++;
        continue;
      }

      const headers = await findEbmlHeaderOffsets(inputPath);
      const hasCues = await fileHasCues(inputPath);
      const isBroken = headers.length > 1 || !hasCues;
      if (!isBroken) {
        healthy++;
        continue;
      }
      broken++;
      console.log(
        `[broken] ${id}: segments=${headers.length} cues=${hasCues} key=${storageKey}`,
      );
      if (!apply) continue;

      const outputPath = path.join(tmpDir, "repaired.webm");
      const ok = await remuxWebMFromPaths(inputPath, outputPath);
      if (!ok) {
        console.warn(`[failed] ${id}: remux failed, leaving stored file untouched`);
        failed++;
        continue;
      }
      const outHeaders = await findEbmlHeaderOffsets(outputPath);
      const outCues = await fileHasCues(outputPath);
      const outSize = (await fs.stat(outputPath)).size;
      if (outHeaders.length !== 1 || !outCues || outSize === 0) {
        console.warn(
          `[failed] ${id}: repaired output failed verification (segments=${outHeaders.length} cues=${outCues} bytes=${outSize}), leaving stored file untouched`,
        );
        failed++;
        continue;
      }

      // playback.webm is the only copy of the recording (chunks were deleted
      // after merge) — keep the original beside it before overwriting.
      const backupKey = `${id}/playback-preremux.webm`;
      await storage.storeBlobFromFile(backupKey, inputPath);
      await storage.storeBlobFromFile(storageKey, outputPath);
      await ProctoringSessionModel.updateOne(
        { _id: id },
        { $set: { "mergedVideo.sizeBytes": outSize } },
      );
      repaired++;
      console.log(`[repaired] ${id}: ${outSize} bytes, backup at ${backupKey}`);
    } catch (err) {
      failed++;
      console.error(`[error] ${id}:`, err instanceof Error ? err.message : err);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log(
    `Done. healthy=${healthy} broken=${broken}${apply ? ` repaired=${repaired} failed=${failed}` : ""} missing=${missing}${apply ? "" : " (dry-run, no writes)"}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
