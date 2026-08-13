/**
 * One-off: export Shabad Vaswani proctoring recording to a local MP4.
 * Uses buildSessionWebmForPlayback (does NOT delete S3 chunks / mutate merge state).
 */
import "../src/config/loadEnv.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import connectMongoose from "../src/db/mongooseConnection.js";
import ProctoringSessionModel from "../src/models/proctoringSession.js";
import { getFrameStorage } from "../src/services/capture/storage.js";
import {
  buildSessionWebmForPlayback,
  mergedPlaybackStorageKey,
} from "../src/services/capture/sessionVideoMerge.js";

const SUBMISSION_ID = process.argv[2] || "6a7601cc0aa5d90129cd2c16";
const OUT_DIR =
  process.argv[3] ||
  path.join(process.cwd(), "storage", "exports");

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function ffprobeDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
    p.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
    p.on("error", () => resolve(null));
  });
}

async function main() {
  await connectMongoose();
  const session = await ProctoringSessionModel.findOne({
    submissionId: SUBMISSION_ID,
  }).lean();
  if (!session) {
    throw new Error(`No proctoring session for submission ${SUBMISSION_ID}`);
  }

  const sessionId = session._id.toString();
  const storage = getFrameStorage();
  const playbackKey =
    (session as any).mergedVideo?.storageKey ||
    mergedPlaybackStorageKey(sessionId);

  console.log(
    JSON.stringify(
      {
        submissionId: SUBMISSION_ID,
        sessionId,
        status: (session as any).status,
        videoChunksCount: (session as any).videoChunks?.length ?? 0,
        mergedVideo: (session as any).mergedVideo ?? null,
        playbackKey,
        storageBackend: process.env.PROCTORING_STORAGE_BACKEND || null,
        s3Bucket:
          process.env.PROCTORING_S3_BUCKET ||
          process.env.AWS_S3_BUCKET ||
          null,
      },
      null,
      2,
    ),
  );

  await fs.mkdir(OUT_DIR, { recursive: true });
  const webmOut = path.join(
    OUT_DIR,
    `shabad-vaswani-${sessionId}-playback.webm`,
  );
  const mp4Out = path.join(
    OUT_DIR,
    `shabad-vaswani-${sessionId}-playback.mp4`,
  );

  let webmSource: string | null = null;
  let cleanup: (() => Promise<void>) | null = null;
  let sourceKind = "";

  const playbackExists = await storage.exists(playbackKey);
  console.log(`playbackExists=${playbackExists} key=${playbackKey}`);

  if (playbackExists) {
    console.log("Downloading existing playback.webm from storage...");
    const buf = await storage.getVideoChunk(playbackKey);
    await fs.writeFile(webmOut, buf);
    webmSource = webmOut;
    sourceKind = "existing_playback";
    console.log(`Wrote ${webmOut} (${buf.length} bytes)`);
  } else {
    console.log(
      "No merged playback; building from chunks via buildSessionWebmForPlayback (read-only)...",
    );
    let listed = 0;
    try {
      const keys = await storage.listKeys(`${sessionId}/video`);
      listed = keys.filter((k) => k.endsWith(".webm")).length;
      console.log(`S3 listKeys(${sessionId}/video) webm count = ${listed}`);
    } catch (e: any) {
      console.warn("listKeys failed:", e?.message || e);
    }

    const built = await buildSessionWebmForPlayback(
      sessionId,
      session as any,
      storage,
    );
    if (!built) {
      throw new Error(
        `Could not build playback: no chunks (DB=${(session as any).videoChunks?.length ?? 0}, listed=${listed})`,
      );
    }
    cleanup = built.cleanup;
    webmSource = built.filePath;
    sourceKind = built.remuxed ? "chunks_remuxed" : "chunks_concat";
    // Copy out of temp before cleanup
    await fs.copyFile(built.filePath, webmOut);
    console.log(
      `Built webm -> ${webmOut} remuxed=${built.remuxed} source=${sourceKind}`,
    );
  }

  console.log("Converting to MP4 with ffmpeg (H.264 + AAC)...");
  await run("ffmpeg", [
    "-y",
    "-i",
    webmSource!,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    mp4Out,
  ]);

  const [webmStat, mp4Stat] = await Promise.all([
    fs.stat(webmOut).catch(() => null),
    fs.stat(mp4Out),
  ]);
  const duration = await ffprobeDuration(mp4Out);

  if (cleanup) await cleanup();

  console.log(
    JSON.stringify(
      {
        ok: true,
        sourceKind,
        mp4Path: mp4Out,
        mp4Bytes: mp4Stat.size,
        webmPath: webmOut,
        webmBytes: webmStat?.size ?? null,
        durationSeconds: duration,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
