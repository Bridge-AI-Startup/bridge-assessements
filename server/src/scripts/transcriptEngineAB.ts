/**
 * A/B compare transcript engines on one proctoring session — no DB/storage writes.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/transcriptEngineAB.ts                       # list candidate sessions
 *   npx tsx src/scripts/transcriptEngineAB.ts <sessionId> --plan-only
 *   npx tsx src/scripts/transcriptEngineAB.ts <sessionId> --engines=gemini,frames --max-minutes=5
 *
 * Outputs transcripts + a stats summary to --out-dir (default ./storage/ab-transcripts/<sessionId>).
 * The gemini engine needs GEMINI_API_KEY; frames needs OPENAI_API_KEY.
 */

import "../config/loadEnv.js";
import fs from "fs/promises";
import path from "path";
import connectMongoose from "../db/mongooseConnection.js";
import mongoose from "mongoose";
import ProctoringSessionModel from "../models/proctoringSession.js";
import {
  generateSegmentsWithGemini,
  materializeSessionVideo,
  planWindows,
} from "../ai/transcript/geminiVideoEngine.js";
import { getVideoDurationSeconds } from "../services/capture/videoFrameExtractor.js";
import { prepareSessionForTranscript } from "../services/capture/framePrep.js";
import { processWithPromptOnly } from "../ai/transcript/generator.js";
import { stitchBatchOutputs } from "../ai/transcript/stitcher.js";

// $/1M tokens (input, output) — for rough cost lines in the summary only.
const PRICES: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10],
  "gpt-5.6-luna": [0.2, 1.2],
  "gpt-4o-mini": [0.15, 0.6],
  "gemini-3.6-flash": [1.5, 7.5],
  "gemini-3.1-flash-lite": [0.25, 1.5],
  "gemini-2.5-flash": [0.3, 2.5],
};

function cost(model: string, promptTok: number, completionTok: number): string {
  const p = PRICES[model];
  if (!p) return "unknown";
  return `$${((promptTok * p[0] + completionTok * p[1]) / 1e6).toFixed(4)}`;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

async function listCandidateSessions(): Promise<void> {
  const sessions = await ProctoringSessionModel.find({
    $or: [
      { "mergedVideo.status": "ready" },
      { "videoChunks.0": { $exists: true } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(15)
    .select("status mergedVideo.status mergedVideo.durationSeconds videoChunks stats.captureStartedAt stats.captureEndedAt createdAt")
    .lean();

  console.log("Recent sessions with video:\n");
  for (const s of sessions as any[]) {
    const dur =
      s.mergedVideo?.durationSeconds ??
      (s.stats?.captureStartedAt && s.stats?.captureEndedAt
        ? (new Date(s.stats.captureEndedAt).getTime() -
            new Date(s.stats.captureStartedAt).getTime()) /
          1000
        : null);
    console.log(
      `${s._id}  status=${s.status}  merged=${s.mergedVideo?.status ?? "-"}  chunks=${s.videoChunks?.length ?? 0}  ~${dur != null ? Math.round(dur) + "s" : "?"}  created=${new Date(s.createdAt).toISOString().slice(0, 16)}`,
    );
  }
  console.log("\nRun: npx tsx src/scripts/transcriptEngineAB.ts <sessionId> --plan-only");
}

async function planOnly(sessionId: string): Promise<void> {
  const video = await materializeSessionVideo(sessionId);
  if (!video) {
    console.log("No video available for this session.");
    return;
  }
  try {
    const durationSec = await getVideoDurationSeconds(video.filePath);
    const stat = await fs.stat(video.filePath);
    const windows = planWindows(durationSec);
    const fps = Number(process.env.TRANSCRIPT_GEMINI_FPS) || 1;
    const tokPerFrame =
      (process.env.TRANSCRIPT_GEMINI_MEDIA_RESOLUTION || "high") === "high" ? 280 : 70;
    const estVideoTokens = Math.round(durationSec * fps * tokPerFrame);
    console.log(`Video: ${(stat.size / 1e6).toFixed(1)} MB, ${durationSec.toFixed(0)}s`);
    console.log(`Windows (${windows.length}):`);
    for (const w of windows) {
      console.log(`  request [${w.requestStartSec}s → ${w.requestEndSec}s], core from ${w.coreStartSec}s`);
    }
    console.log(
      `Estimated video input tokens @ ${fps}fps, ${tokPerFrame} tok/frame: ~${estVideoTokens.toLocaleString()}`,
    );
    const model = process.env.TRANSCRIPT_GEMINI_MODEL || "gemini-3.6-flash";
    console.log(`Estimated input cost (${model}): ${cost(model, estVideoTokens, 0)}`);
  } finally {
    await video.cleanup().catch(() => {});
  }
}

async function runGemini(
  sessionId: string,
  outDir: string,
  maxDurationSec?: number,
): Promise<void> {
  const start = Date.now();
  const result = await generateSegmentsWithGemini(sessionId, { maxDurationSec });
  const elapsed = Date.now() - start;
  const jsonl = result.segments.map((s) => JSON.stringify(s)).join("\n");
  await fs.writeFile(path.join(outDir, "gemini.jsonl"), jsonl);
  const summary = [
    `engine: gemini (${result.model})`,
    `video: ${result.videoDurationSec.toFixed(0)}s in ${result.windowCount} window(s)`,
    `segments: ${result.segments.length}`,
    `tokens: ${result.promptTokens} prompt + ${result.completionTokens} completion`,
    `est. cost: ${cost(result.model, result.promptTokens, result.completionTokens)}`,
    `wall clock: ${(elapsed / 1000).toFixed(1)}s`,
  ].join("\n");
  await fs.writeFile(path.join(outDir, "gemini.stats.txt"), summary);
  console.log(`\n=== GEMINI ===\n${summary}`);
}

async function runFrames(
  sessionId: string,
  outDir: string,
  maxDurationSec?: number,
): Promise<void> {
  const start = Date.now();
  const prepared = await prepareSessionForTranscript(sessionId);
  try {
    let frames = prepared.frames;
    if (maxDurationSec != null && frames.length > 0) {
      const cutoff = frames[0].capturedAt.getTime() + maxDurationSec * 1000;
      frames = frames.filter((f) => f.capturedAt.getTime() <= cutoff);
    }
    console.log(`[frames] ${frames.length}/${prepared.frames.length} frames selected`);
    const { batchOutputs, totalPromptTokens, totalCompletionTokens } =
      await processWithPromptOnly(frames);
    const jsonl = stitchBatchOutputs(batchOutputs);
    const elapsed = Date.now() - start;
    await fs.writeFile(path.join(outDir, "frames.jsonl"), jsonl);
    const model = process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna";
    const summary = [
      `engine: frames (${model})`,
      `frames: ${frames.length}`,
      `segments: ${jsonl.split("\n").filter(Boolean).length}`,
      `tokens: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion`,
      `est. cost: ${cost(model, totalPromptTokens, totalCompletionTokens)}`,
      `wall clock: ${(elapsed / 1000).toFixed(1)}s`,
    ].join("\n");
    await fs.writeFile(path.join(outDir, "frames.stats.txt"), summary);
    console.log(`\n=== FRAMES ===\n${summary}`);
  } finally {
    await prepared.cleanup?.().catch(() => {});
  }
}

async function main() {
  await connectMongoose();
  const sessionId = process.argv[2]?.match(/^[0-9a-f]{24}$/) ? process.argv[2] : undefined;

  if (!sessionId) {
    await listCandidateSessions();
    return;
  }

  if (process.argv.includes("--plan-only")) {
    await planOnly(sessionId);
    return;
  }

  const engines = (arg("engines") || "gemini,frames").split(",").map((e) => e.trim());
  const maxMinutes = arg("max-minutes") ? Number(arg("max-minutes")) : undefined;
  const maxDurationSec = maxMinutes ? maxMinutes * 60 : undefined;
  const outDir =
    arg("out-dir") || path.join(process.cwd(), "storage", "ab-transcripts", sessionId);
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Session ${sessionId} | engines: ${engines.join(", ")} | max: ${maxMinutes ?? "full"} min\nOutput → ${outDir}`);

  for (const engine of engines) {
    try {
      if (engine === "gemini") await runGemini(sessionId, outDir, maxDurationSec);
      else if (engine === "frames") await runFrames(sessionId, outDir, maxDurationSec);
      else console.warn(`Unknown engine: ${engine}`);
    } catch (err) {
      console.error(`\n=== ${engine.toUpperCase()} FAILED ===\n`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
