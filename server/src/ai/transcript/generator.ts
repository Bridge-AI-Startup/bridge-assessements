/**
 * Transcript generation orchestrator.
 * Prepares frames → batches → vision API → stitch → inject events → store.
 *
 * Two modes:
 * 1. Prompt-only (default): uses a region-aware system prompt that instructs
 *    the model to output separate JSONL lines per region with different detail levels.
 * 2. Vision-based region detection (TRANSCRIPT_REGION_DETECTION=true): detects
 *    UI panels via GPT-4o-mini, crops each region, and processes with tailored prompts.
 */

import ProctoringSessionModel from "../../models/proctoringSession.js";
import {
  prepareSessionForTranscript,
  prepareSessionForTranscriptSince,
} from "../../services/capture/framePrep.js";
import { getFrameStorage } from "../../services/capture/storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import { createBatches } from "./batcher.js";
import { analyzeFrameBatch, VisionFrame } from "./visionClient.js";
import { stitchBatchOutputs, parseTranscriptJsonlToSegments } from "./stitcher.js";
import { injectSidecarEvents } from "./manifestInjector.js";
import { PROMPT_TRANSCRIPT_SYSTEM } from "../../prompts/index.js";
import {
  isRegionDetectionEnabled,
  detectRegions,
  cropRegions,
  DetectedRegion,
} from "./regionDetector.js";
import { REGION_PROMPTS } from "../../prompts/regionPrompts.js";
import { ocrRegionBatch } from "./ocrEngine.js";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { logTs } from "./logger.js";

export interface TranscriptResult {
  storageKey: string;
  frameCount: number;
  tokenUsage: { prompt: number; completion: number; total: number };
}

/** Update progress fields so clients can poll and show "frame X of Y" / "batch A of B". */
async function updateTranscriptProgress(
  sessionId: string,
  generationId: number,
  update: {
    progressTotalFrames?: number;
    progressFramesProcessed?: number;
    progressBatchIndex?: number;
    progressTotalBatches?: number;
  }
): Promise<void> {
  const $set: Record<string, number> = {};
  if (update.progressTotalFrames != null) $set["transcript.progressTotalFrames"] = update.progressTotalFrames;
  if (update.progressFramesProcessed != null) $set["transcript.progressFramesProcessed"] = update.progressFramesProcessed;
  if (update.progressBatchIndex != null) $set["transcript.progressBatchIndex"] = update.progressBatchIndex;
  if (update.progressTotalBatches != null) $set["transcript.progressTotalBatches"] = update.progressTotalBatches;
  if (Object.keys($set).length === 0) return;
  await ProctoringSessionModel.findOneAndUpdate(
    { _id: sessionId, "transcript.generationId": generationId },
    { $set }
  );
}

/**
 * Generate a raw visual transcript for a proctoring session.
 * This is the single entry point called by the controller.
 */
export async function generateTranscript(
  sessionId: string
): Promise<TranscriptResult> {
  // Check if generation is enabled
  if (process.env.TRANSCRIPT_GENERATION_ENABLED === "false") {
    throw ProctoringError.TRANSCRIPT_GENERATION_DISABLED;
  }

  // Check session exists
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  // Allow starting even when status is "generating" (regenerate from scratch); we use generationId so only the latest run writes completion.
  const generationId = Date.now();
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.status": "generating",
    "transcript.generationId": generationId,
    "transcript.error": null,
    "transcript.progressTotalFrames": null,
    "transcript.progressFramesProcessed": null,
    "transcript.progressBatchIndex": null,
    "transcript.progressTotalBatches": null,
    "transcript.refinedStatus": "not_started",
    "transcript.refinedStorageKey": null,
    "transcript.refinedAt": null,
    "transcript.refinedError": null,
  });

  try {
    const genStart = Date.now();
    logTs("transcript", `Preparing session ${sessionId}...`);
    const prepStart = Date.now();
    const prepared = await prepareSessionForTranscript(sessionId);
    logTs("transcript", `Prepared: ${prepared.frames.length} frames, ${prepared.sidecarEvents.length} sidecar events`, Date.now() - prepStart);

    if (prepared.frames.length === 0) {
      throw new Error("No frames available for transcript generation");
    }

    await updateTranscriptProgress(sessionId, generationId, {
      progressTotalFrames: prepared.frames.length,
      progressFramesProcessed: 0,
    });

    const useRegionDetection = isRegionDetectionEnabled();
    logTs("transcript", `Mode: ${useRegionDetection ? "vision-based region detection" : "prompt-only region awareness"}`);

    let batchOutputs: string[];
    let totalPromptTokens: number;
    let totalCompletionTokens: number;

    const processStart = Date.now();
    if (useRegionDetection) {
      ({ batchOutputs, totalPromptTokens, totalCompletionTokens } =
        await processWithRegionDetection(sessionId, generationId, prepared.frames));
    } else {
      ({ batchOutputs, totalPromptTokens, totalCompletionTokens } =
        await processWithPromptOnly(prepared.frames, { sessionId, generationId }));
    }
    logTs("transcript", `Processing complete: ${batchOutputs.length} batch outputs`, Date.now() - processStart);

    const stitchStart = Date.now();
    logTs("transcript", `Stitching ${batchOutputs.length} batch outputs...`);
    let jsonl = stitchBatchOutputs(batchOutputs);
    const lineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    logTs("transcript", `Stitched: ${lineCount} JSONL lines`, Date.now() - stitchStart);

    const injectStart = Date.now();
    jsonl = injectSidecarEvents(jsonl, prepared.sidecarEvents);
    const finalLineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    logTs("transcript", `After sidecar injection: ${finalLineCount} lines`, Date.now() - injectStart);

    const storeStart = Date.now();
    const storage = getFrameStorage();
    const storageKey = `${sessionId}/transcript.jsonl`;
    await storage.storeTranscript(storageKey, jsonl);
    logTs("transcript", `Stored at ${storageKey}`, Date.now() - storeStart);

    const tokenUsage = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    const updateResult = await ProctoringSessionModel.findOneAndUpdate(
      { _id: sessionId, "transcript.generationId": generationId },
      {
        "transcript.status": "completed",
        "transcript.storageKey": storageKey,
        "transcript.generatedAt": new Date(),
        "transcript.frameCount": prepared.frames.length,
        "transcript.tokenUsage": tokenUsage,
        "transcript.progressTotalFrames": null,
        "transcript.progressFramesProcessed": null,
        "transcript.progressBatchIndex": null,
        "transcript.progressTotalBatches": null,
      },
      { new: true }
    );
    if (!updateResult) {
      logTs("transcript", `Session ${sessionId} was superseded by a newer run; skipping completion write.`);
      return { storageKey, frameCount: prepared.frames.length, tokenUsage };
    }

    logTs("transcript", `Done! ${prepared.frames.length} frames → ${finalLineCount} segments | ${totalPromptTokens + totalCompletionTokens} total tokens`, Date.now() - genStart);

    return {
      storageKey,
      frameCount: prepared.frames.length,
      tokenUsage,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] [transcript] FAILED for session ${sessionId}:`, errorMessage);
    if (error instanceof Error && error.stack) {
      console.error(`[${new Date().toISOString()}] [transcript] Stack:`, error.stack);
    }
    await ProctoringSessionModel.findOneAndUpdate(
      { _id: sessionId, "transcript.generationId": generationId },
      {
        "transcript.status": "failed",
        "transcript.error": errorMessage,
        "transcript.progressTotalFrames": null,
        "transcript.progressFramesProcessed": null,
        "transcript.progressBatchIndex": null,
        "transcript.progressTotalBatches": null,
      }
    );
    throw error;
  }
}

export interface IncrementalTranscriptResult {
  mergedSegmentCount: number;
  newSegmentCount: number;
  frameCount: number;
}

/**
 * Run transcript generation on frames with capturedAt >= sinceMs and merge with existing transcript.
 * Used by the sliding-window scheduler for active sessions. Does not set transcript.status to "completed".
 */
export async function generateTranscriptIncremental(
  sessionId: string,
  options: { sinceMs: number }
): Promise<IncrementalTranscriptResult> {
  if (process.env.TRANSCRIPT_GENERATION_ENABLED === "false") {
    throw ProctoringError.TRANSCRIPT_GENERATION_DISABLED;
  }

  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  const prepared = await prepareSessionForTranscriptSince(sessionId, options.sinceMs);
  if (prepared.frames.length === 0) {
    return { mergedSegmentCount: 0, newSegmentCount: 0, frameCount: 0 };
  }

  logTs("transcript", `Incremental: session ${sessionId}, ${prepared.frames.length} frames since ${new Date(options.sinceMs).toISOString()}`);

  const useRegionDetection = isRegionDetectionEnabled();
  let batchOutputs: string[];
  if (useRegionDetection) {
    const result = await processWithRegionDetection(sessionId, undefined, prepared.frames);
    batchOutputs = result.batchOutputs;
  } else {
    const result = await processWithPromptOnly(prepared.frames);
    batchOutputs = result.batchOutputs;
  }

  let jsonl = stitchBatchOutputs(batchOutputs);
  jsonl = injectSidecarEvents(jsonl, prepared.sidecarEvents);

  const storage = getFrameStorage();
  const storageKey = `${sessionId}/transcript.jsonl`;
  let existingJsonl = "";
  try {
    existingJsonl = await storage.getTranscript(storageKey);
  } catch {
    // no existing transcript
  }

  const existingSegments = parseTranscriptJsonlToSegments(existingJsonl);
  const newSegments = parseTranscriptJsonlToSegments(jsonl);
  const combined = [...existingSegments, ...newSegments];
  combined.sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    if (ta !== tb) return ta - tb;
    return (a.screen ?? 0) - (b.screen ?? 0);
  });

  const mergedJsonl = combined.map((seg) => JSON.stringify(seg)).join("\n");
  await storage.storeTranscript(storageKey, mergedJsonl);

  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.lastIncrementalAt": new Date(),
    "transcript.storageKey": storageKey,
  });

  logTs("transcript", `Incremental done: ${newSegments.length} new segments, ${combined.length} total merged`);

  return {
    mergedSegmentCount: combined.length,
    newSegmentCount: newSegments.length,
    frameCount: prepared.frames.length,
  };
}

// Prompt-only batch size (env: TRANSCRIPT_BATCH_SIZE, default 2; larger = fewer API calls, more tokens per request)
const TRANSCRIPT_BATCH_SIZE = (() => {
  const raw = process.env.TRANSCRIPT_BATCH_SIZE;
  if (raw == null || raw === "") return 2;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 2;
})();
// Max concurrent batch API calls (env: TRANSCRIPT_BATCH_CONCURRENCY; set OPENAI_MAX_CONCURRENT >= this)
const TRANSCRIPT_BATCH_CONCURRENCY = (() => {
  const raw = process.env.TRANSCRIPT_BATCH_CONCURRENCY;
  if (raw == null || raw === "") return 2;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(8, n)) : 2;
})();

/**
 * Process frames using the prompt-only approach (default).
 * The system prompt instructs the model to identify regions and output
 * separate JSONL lines per region with different detail levels.
 * Batches are processed with limited concurrency to speed up generation.
 */
async function processWithPromptOnly(
  frames: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number }>,
  options?: { sessionId?: string; generationId?: number }
): Promise<{
  batchOutputs: string[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}> {
  const batches = createBatches(frames as any, TRANSCRIPT_BATCH_SIZE);
  logTs(
    "transcript",
    `Created ${batches.length} batch(es) [prompt-only mode, batchSize=${TRANSCRIPT_BATCH_SIZE}, concurrency=${TRANSCRIPT_BATCH_CONCURRENCY}]`
  );

  if (options?.sessionId && options?.generationId != null) {
    await updateTranscriptProgress(options.sessionId, options.generationId, {
      progressTotalBatches: batches.length,
    });
  }

  const resultsByIndex = new Map<
    number,
    { text: string; promptTokens: number; completionTokens: number }
  >();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let completedCount = 0;
  let totalFramesProcessed = 0;

  // Concurrency pool: run up to TRANSCRIPT_BATCH_CONCURRENCY batches at a time
  let inFlight = 0;
  const queue: Array<() => void> = [];
  const waitSlot = (): Promise<void> => {
    if (inFlight < TRANSCRIPT_BATCH_CONCURRENCY) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  };
  const releaseSlot = (): void => {
    inFlight--;
    const next = queue.shift();
    if (next) {
      inFlight++;
      next();
    }
  };

  const runOne = async (
    batch: (typeof batches)[0]
  ): Promise<void> => {
    await waitSlot();
    try {
      const visionFrames: VisionFrame[] = batch.frames.map((f) => ({
        buffer: f.buffer,
        capturedAt: f.capturedAt,
        screenIndex: f.screenIndex,
      }));
      const result = await analyzeFrameBatch(
        visionFrames,
        PROMPT_TRANSCRIPT_SYSTEM
      );
      resultsByIndex.set(batch.batchIndex, {
        text: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      completedCount++;
      totalFramesProcessed += batch.frames.length;
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      if (options?.sessionId && options?.generationId != null) {
        await updateTranscriptProgress(options.sessionId, options.generationId, {
          progressBatchIndex: completedCount - 1,
          progressFramesProcessed: totalFramesProcessed,
        });
      }
      logTs("transcript", `Batch ${batch.batchIndex} done: ${result.promptTokens} prompt + ${result.completionTokens} completion tokens`);
    } finally {
      releaseSlot();
    }
  };

  await Promise.all(batches.map((batch) => runOne(batch)));

  const batchOutputs = batches
    .map((b) => resultsByIndex.get(b.batchIndex)!.text)
    .filter(Boolean);

  return { batchOutputs, totalPromptTokens, totalCompletionTokens };
}

// High-priority regions use GPT-4o for maximum accuracy
const HIGH_PRIORITY_REGIONS = new Set(["ai_chat"]);
// Low-priority regions use GPT-4o-mini to save cost and get dedup'd
const LOW_PRIORITY_REGIONS = new Set(["editor", "terminal", "file_tree", "other"]);
// Max crops to batch together for same region type (env: TRANSCRIPT_REGION_BATCH_SIZE, default 5)
const REGION_BATCH_SIZE = (() => {
  const raw = process.env.TRANSCRIPT_REGION_BATCH_SIZE;
  if (raw == null || raw === "") return 5;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 5;
})();
// Re-detect layout every N frames (env: TRANSCRIPT_LAYOUT_REDETECT_INTERVAL, default 90)
const LAYOUT_REDETECT_INTERVAL = (() => {
  const raw = process.env.TRANSCRIPT_LAYOUT_REDETECT_INTERVAL;
  if (raw == null || raw === "") return 90;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 90;
})();
// Pixel-diff threshold for full-frame change that triggers layout re-detection
const LAYOUT_CHANGE_THRESHOLD = 0.15; // 15% pixel diff = likely app switch or resize

// Regions that use the OCR cache (thumb-diff reuse; more aggressive = fewer API calls)
const CACHEABLE_REGIONS = new Set(["file_tree", "terminal"]);
const OCR_CACHE_THUMB_SIZE = 64;
const OCR_CACHE_CHANGE_THRESHOLD = parseFloat(
  process.env.TRANSCRIPT_OCR_CACHE_CHANGE_THRESHOLD || "0.6",
  10
);

/**
 * Get the model to use for a given region type.
 * High-priority (ai_chat) → GPT-4o
 * When terminal is the "chat" (aiChatLocation === "terminal"), use GPT-4o for terminal too.
 * Low-priority (editor, terminal, file_tree) → GPT-4o-mini
 * Browser → GPT-4o (may contain AI tools)
 */
function getModelForRegion(
  regionType: string,
  aiChatLocation: "sidebar" | "terminal" | "none"
): string {
  if (regionType === "terminal" && aiChatLocation === "terminal") {
    return process.env.OPENAI_VISION_MODEL || "gpt-4o";
  }
  if (HIGH_PRIORITY_REGIONS.has(regionType) || regionType === "browser") {
    return process.env.OPENAI_VISION_MODEL || "gpt-4o";
  }
  return process.env.OPENAI_VISION_MODEL_LITE || "gpt-4o-mini";
}

/**
 * Process frames using vision-based region detection.
 *
 * Adaptive optimizations:
 * 1. Hybrid models: GPT-4o for ai_chat, GPT-4o-mini for editor/terminal/file_tree
 * 2. Region batching: consecutive crops of same region type batched into single API call
 * 3. Low-priority dedup: skips editor/terminal/file_tree if visually unchanged
 * 4. Cached layout detection: detect regions once, reuse bounding boxes, re-detect
 *    only on major visual change or every LAYOUT_REDETECT_INTERVAL frames
 * 5. Idle frame dropping: skip frames where full-frame hash matches previous frame
 */
type AiChatLocation = "sidebar" | "terminal" | "none";

function deriveAiChatLocation(layout: DetectedRegion[] | null): AiChatLocation {
  if (!layout || layout.length === 0) return "none";
  if (layout.some((r) => r.regionType === "ai_chat")) return "sidebar";
  if (layout.some((r) => r.regionType === "terminal")) return "terminal";
  return "none";
}

async function processWithRegionDetection(
  sessionId: string,
  generationId: number | undefined,
  frames: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number; width: number; height: number }>
): Promise<{
  batchOutputs: string[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}> {
  logTs("transcript", `Processing ${frames.length} frames with region detection...`);

  const batchOutputs: string[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // --- Adaptive state ---

  interface RegionCrop {
    regionType: string;
    frame: VisionFrame;
    frameIndex: number;
  }

  // #4: Cached layout — reuse bounding boxes across frames
  let cachedLayout: DetectedRegion[] | null = null;
  let lastLayoutDetectionFrame = -LAYOUT_REDETECT_INTERVAL; // force first detection
  let lastLayoutThumb: Buffer | null = null;

  // Three-state: where is the AI chat (sidebar, terminal, or none)
  let aiChatLocation: AiChatLocation = "none";

  // OCR cache for file_tree and terminal: only scan when thumb diff >= threshold
  const ocrCache = new Map<
    string,
    { thumb: Buffer; text: string }
  >();
  let ocrCacheFlushIndex = 0;

  // #5: Idle frame dropping — full-frame hash
  let lastFullFrameHash: number | null = null;
  let idleFramesSkipped = 0;

  // #3: Low-priority region dedup
  const lastRegionCropHash = new Map<string, number>();

  // #2: Region batching
  const pendingCrops = new Map<string, RegionCrop[]>();

  const debugSaveCacheThumbs = process.env.TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS === "true";
  const debugThumbsDir =
    process.env.TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR ||
    path.join(
      process.env.PROCTORING_STORAGE_DIR || path.join(process.cwd(), "storage", "proctoring"),
      "ocr-cache-thumbs"
    );

  async function buildThumbForCrop(cropBuffer: Buffer): Promise<Buffer> {
    return sharp(cropBuffer)
      .resize(OCR_CACHE_THUMB_SIZE, OCR_CACHE_THUMB_SIZE, { fit: "fill" })
      .raw()
      .toBuffer();
  }

  async function saveDebugCacheThumb(
    regionType: string,
    thumbRaw: Buffer,
    index: number
  ): Promise<void> {
    if (!debugSaveCacheThumbs) return;
    try {
      const dir = path.join(debugThumbsDir, sessionId);
      await fs.mkdir(dir, { recursive: true });
      const filename = `${regionType}_${index}_${Date.now()}.png`;
      const filePath = path.join(dir, filename);
      const png = await sharp(thumbRaw, {
        raw: {
          width: OCR_CACHE_THUMB_SIZE,
          height: OCR_CACHE_THUMB_SIZE,
          channels: 3,
        },
      })
        .png()
        .toBuffer();
      await fs.writeFile(filePath, png);
      logTs("transcript", `Debug: saved cache thumb to ${filePath}`);
    } catch (err) {
      console.warn(`[${new Date().toISOString()}] [transcript] Debug: failed to save cache thumb:`, err);
    }
  }

  function reemitCachedJsonl(
    cachedText: string,
    crops: RegionCrop[],
    regionType: string
  ): string {
    const app =
      regionType === "ai_chat"
        ? "AI Chat"
        : regionType === "terminal"
          ? "Terminal"
          : regionType === "file_tree"
            ? "File tree"
            : regionType === "editor"
              ? "Editor"
              : "Other";
    const lines = cachedText.split("\n").filter((l) => l.trim());
    const segments: Array<{ ts: string; screen: number; text_content: string }> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim().replace(/^```(?:json|jsonl)?/, "").replace(/^```$/, "").trim());
        if (parsed.text_content != null) {
          segments.push({
            ts: parsed.ts,
            screen: parsed.screen ?? 0,
            text_content: parsed.text_content,
          });
        }
      } catch {
        // skip non-json lines
      }
    }
    const out: string[] = [];
    for (let i = 0; i < crops.length; i++) {
      const crop = crops[i];
      const seg = segments[Math.min(i, segments.length - 1)] || segments[0];
      const text_content = seg ? seg.text_content : "";
      out.push(
        JSON.stringify({
          ts: crop.frame.capturedAt.toISOString(),
          screen: crop.frame.screenIndex,
          region: regionType,
          app,
          text_content,
        })
      );
    }
    return out.join("\n");
  }

  /**
   * Flush pending crops for a region type.
   * Returns result for caller to push to batchOutputs and add token counts (enables parallel flush).
   * For ai_chat: always run OCR (no cache). Same for terminal when aiChatLocation === "terminal".
   * For file_tree and terminal (when not the chat): use 50% thumb-diff cache when diff < threshold.
   */
  async function flushRegion(
    regionType: string
  ): Promise<{ text: string; promptTokens: number; completionTokens: number } | null> {
    const crops = pendingCrops.get(regionType);
    if (!crops || crops.length === 0) return null;

    const regionPrompt = REGION_PROMPTS[regionType] || REGION_PROMPTS["other"];
    const model = getModelForRegion(regionType, aiChatLocation);
    const cropData = crops.map((c) => ({
      buffer: c.frame.buffer,
      capturedAt: c.frame.capturedAt,
      screenIndex: c.frame.screenIndex,
    }));

    const isTerminalAsChat = regionType === "terminal" && aiChatLocation === "terminal";
    const useCache = CACHEABLE_REGIONS.has(regionType) && !isTerminalAsChat;

    if (isTerminalAsChat) {
      logTs("transcript", `Aggressive scan for chat region: ${regionType} (aiChatLocation=${aiChatLocation})`);
    }

    if (useCache) {
      const currentThumb = await buildThumbForCrop(cropData[0].buffer);
      const cached = ocrCache.get(regionType);
      if (cached) {
        const diff = computeThumbDiff(cached.thumb, currentThumb, OCR_CACHE_THUMB_SIZE);
        if (diff < OCR_CACHE_CHANGE_THRESHOLD) {
          const reused = reemitCachedJsonl(cached.text, crops, regionType);
          pendingCrops.set(regionType, []);
          logTs("transcript", `Reusing cached OCR for ${regionType} (diff ${(diff * 100).toFixed(1)}% < ${OCR_CACHE_CHANGE_THRESHOLD * 100}%)`);
          return { text: reused, promptTokens: 0, completionTokens: 0 };
        }
      }
    }

    logTs("transcript", `Flushing ${crops.length} ${regionType} crop(s) via OCR engine (model fallback: ${model})`);

    const result = await ocrRegionBatch(
      cropData,
      regionType,
      regionPrompt,
      model
    );

    if (useCache) {
      const thumb = await buildThumbForCrop(cropData[0].buffer);
      ocrCache.set(regionType, { thumb, text: result.text });
      ocrCacheFlushIndex++;
      await saveDebugCacheThumb(regionType, thumb, ocrCacheFlushIndex);
    }

    pendingCrops.set(regionType, []);
    return {
      text: result.text,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  /** Flush all regions that have pending crops (optionally only trigger + regions with full batch), in parallel. */
  async function flushAllPendingParallel(triggerRegionType: string | null) {
    const regionTypes = Array.from(pendingCrops.keys());
    const toFlush: string[] = regionTypes.filter((rt) => {
      const pending = pendingCrops.get(rt)!;
      if (!pending || pending.length === 0) return false;
      if (triggerRegionType === null) return true;
      return rt === triggerRegionType || pending.length >= REGION_BATCH_SIZE;
    });
    if (toFlush.length === 0) return;
    const sorted = [...toFlush].sort();
    const results = await Promise.all(sorted.map((rt) => flushRegion(rt)));
    for (let i = 0; i < sorted.length; i++) {
      const r = results[i];
      if (r) {
        batchOutputs.push(r.text);
        totalPromptTokens += r.promptTokens;
        totalCompletionTokens += r.completionTokens;
      }
    }
  }

  /**
   * #4: Decide whether to re-detect layout or reuse cached bounding boxes.
   * Re-detects if: no cache, interval exceeded, or major visual change.
   */
  async function getLayoutForFrame(
    visionFrame: VisionFrame,
    frameIndex: number,
    frameWidth: number,
    frameHeight: number
  ): Promise<DetectedRegion[]> {
    const intervalExceeded =
      frameIndex - lastLayoutDetectionFrame >= LAYOUT_REDETECT_INTERVAL;

    // Check for major visual change via thumbnail diff
    let majorChange = false;
    if (cachedLayout && lastLayoutThumb) {
      try {
        const currentThumb = await sharp(visionFrame.buffer)
          .resize(64, 64, { fit: "fill" })
          .raw()
          .toBuffer();
        const diffRatio = computeThumbDiff(lastLayoutThumb, currentThumb, 64);
        majorChange = diffRatio >= LAYOUT_CHANGE_THRESHOLD;
        if (majorChange) {
          logTs("transcript", `Frame ${frameIndex + 1}: major visual change detected (${(diffRatio * 100).toFixed(1)}% diff), re-detecting layout`);
        }
      } catch {
        // If thumb comparison fails, re-detect to be safe
        majorChange = true;
      }
    }

    if (!cachedLayout || intervalExceeded || majorChange) {
      const regions = await detectRegions(visionFrame);
      if (regions.length > 0) {
        cachedLayout = regions;
        lastLayoutDetectionFrame = frameIndex;
        // Update layout thumbnail
        try {
          lastLayoutThumb = await sharp(visionFrame.buffer)
            .resize(64, 64, { fit: "fill" })
            .raw()
            .toBuffer();
        } catch {
          // non-critical
        }
        logTs("transcript", `Frame ${frameIndex + 1}: layout detected — ${regions.map((r) => r.regionType).join(", ")}`);
      } else if (cachedLayout) {
        logTs("transcript", `Frame ${frameIndex + 1}: detection returned 0 regions, reusing cached layout`);
      }
      aiChatLocation = deriveAiChatLocation(cachedLayout || regions);
      return cachedLayout || regions;
    }

    aiChatLocation = deriveAiChatLocation(cachedLayout);
    return cachedLayout;
  }

  const totalFrames = frames.length;
  const PROGRESS_UPDATE_INTERVAL = 3; // update DB every N frames to avoid excessive writes
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if ((i + 1) % 10 === 0 || i === 0) {
      logTs("transcript", `Progress: frame ${i + 1}/${totalFrames}`);
    }
    if (
      generationId != null &&
      ((i + 1) % PROGRESS_UPDATE_INTERVAL === 0 || i === frames.length - 1)
    ) {
      await updateTranscriptProgress(sessionId, generationId, {
        progressFramesProcessed: i + 1,
      });
    }

    // #5: Idle frame dropping — skip if full frame is identical to previous
    const fullFrameHash = simpleBufferHash(frame.buffer);
    if (lastFullFrameHash !== null && fullFrameHash === lastFullFrameHash) {
      idleFramesSkipped++;
      continue;
    }
    lastFullFrameHash = fullFrameHash;

    const visionFrame: VisionFrame = {
      buffer: frame.buffer,
      capturedAt: frame.capturedAt,
      screenIndex: frame.screenIndex,
    };

    // #4: Get layout (cached or fresh)
    const regions = await getLayoutForFrame(
      visionFrame,
      i,
      frame.width,
      frame.height
    );

    if (!regions || regions.length === 0) {
      await flushAllPendingParallel(null);
      logTs("transcript", `Frame ${i + 1}: no layout available, using full-frame fallback`);
      const result = await analyzeFrameBatch(
        [visionFrame],
        PROMPT_TRANSCRIPT_SYSTEM
      );
      batchOutputs.push(result.text);
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;
      continue;
    }

    // Crop using current (possibly cached) layout
    const cropped = await cropRegions(
      frame.buffer,
      frame.width,
      frame.height,
      regions
    );

    // #3: Queue each crop, with dedup for low-priority regions
    for (const region of cropped) {
      if (LOW_PRIORITY_REGIONS.has(region.regionType)) {
        const cropHash = simpleBufferHash(region.buffer);
        const lastHash = lastRegionCropHash.get(region.regionType);
        if (lastHash !== undefined && lastHash === cropHash) {
          continue; // unchanged, skip
        }
        lastRegionCropHash.set(region.regionType, cropHash);
      }

      const crop: RegionCrop = {
        regionType: region.regionType,
        frame: {
          buffer: region.buffer,
          capturedAt: frame.capturedAt,
          screenIndex: frame.screenIndex,
        },
        frameIndex: i,
      };

      if (!pendingCrops.has(region.regionType)) {
        pendingCrops.set(region.regionType, []);
      }
      pendingCrops.get(region.regionType)!.push(crop);

      // #2: Flush if batch is full (parallel: flush trigger region + any other region with full batch)
      if (pendingCrops.get(region.regionType)!.length >= REGION_BATCH_SIZE) {
        await flushAllPendingParallel(region.regionType);
      }
    }
  }

  // Flush remaining crops in parallel
  await flushAllPendingParallel(null);

  if (idleFramesSkipped > 0) {
    logTs("transcript", `Skipped ${idleFramesSkipped} idle frames (full-frame hash match)`);
  }

  return { batchOutputs, totalPromptTokens, totalCompletionTokens };
}

/**
 * Simple hash for buffer comparison (dedup unchanged regions / idle frames).
 * Samples evenly across the buffer for speed.
 */
function simpleBufferHash(buffer: Buffer): number {
  let hash = 0;
  const step = Math.max(1, Math.floor(buffer.length / 200));
  for (let i = 0; i < buffer.length; i += step) {
    hash = ((hash << 5) - hash + buffer[i]) | 0;
  }
  return hash;
}

/**
 * Compute pixel diff ratio between two raw RGB thumbnail buffers.
 * Used for detecting major visual changes that warrant layout re-detection.
 */
function computeThumbDiff(
  bufA: Buffer,
  bufB: Buffer,
  thumbSize: number
): number {
  const pixels = thumbSize * thumbSize;
  const channels = 3;
  let diffPixels = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * channels;
    if (offset + 2 >= bufA.length || offset + 2 >= bufB.length) break;
    const dr = Math.abs(bufA[offset] - bufB[offset]);
    const dg = Math.abs(bufA[offset + 1] - bufB[offset + 1]);
    const db = Math.abs(bufA[offset + 2] - bufB[offset + 2]);
    if (dr > 25 || dg > 25 || db > 25) {
      diffPixels++;
    }
  }
  return diffPixels / pixels;
}
