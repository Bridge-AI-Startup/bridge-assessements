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
import { prepareSessionForTranscript } from "../../services/capture/framePrep.js";
import { getFrameStorage } from "../../services/capture/storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import { createBatches } from "./batcher.js";
import { analyzeFrameBatch, VisionFrame } from "./visionClient.js";
import { stitchBatchOutputs } from "./stitcher.js";
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

export interface TranscriptResult {
  storageKey: string;
  frameCount: number;
  tokenUsage: { prompt: number; completion: number; total: number };
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

  // Check session status
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  if (session.transcript.status === "generating") {
    throw ProctoringError.TRANSCRIPT_ALREADY_GENERATING;
  }

  // Mark as generating
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.status": "generating",
    "transcript.error": null,
  });

  try {
    console.log(`[transcript] Preparing session ${sessionId}...`);
    const prepared = await prepareSessionForTranscript(sessionId);
    console.log(`[transcript] Prepared: ${prepared.frames.length} frames, ${prepared.sidecarEvents.length} sidecar events`);

    if (prepared.frames.length === 0) {
      throw new Error("No frames available for transcript generation");
    }

    for (const f of prepared.frames) {
      console.log(`[transcript]   Frame: ${f.storageKey} | ${f.width}x${f.height} | screen ${f.screenIndex} | ${f.capturedAt.toISOString()} | ${f.buffer.length} bytes`);
    }

    const useRegionDetection = isRegionDetectionEnabled();
    console.log(`[transcript] Mode: ${useRegionDetection ? "vision-based region detection" : "prompt-only region awareness"}`);

    let batchOutputs: string[];
    let totalPromptTokens: number;
    let totalCompletionTokens: number;

    if (useRegionDetection) {
      ({ batchOutputs, totalPromptTokens, totalCompletionTokens } =
        await processWithRegionDetection(prepared.frames));
    } else {
      ({ batchOutputs, totalPromptTokens, totalCompletionTokens } =
        await processWithPromptOnly(prepared.frames));
    }

    console.log(`[transcript] Stitching ${batchOutputs.length} batch outputs...`);
    let jsonl = stitchBatchOutputs(batchOutputs);
    const lineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    console.log(`[transcript] Stitched: ${lineCount} JSONL lines`);

    jsonl = injectSidecarEvents(jsonl, prepared.sidecarEvents);
    const finalLineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    console.log(`[transcript] After sidecar injection: ${finalLineCount} lines`);

    const storage = getFrameStorage();
    const storageKey = `${sessionId}/transcript.jsonl`;
    await storage.storeTranscript(storageKey, jsonl);
    console.log(`[transcript] Stored at ${storageKey}`);

    const tokenUsage = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.status": "completed",
      "transcript.storageKey": storageKey,
      "transcript.generatedAt": new Date(),
      "transcript.frameCount": prepared.frames.length,
      "transcript.tokenUsage": tokenUsage,
    });

    console.log(`[transcript] Done! ${prepared.frames.length} frames → ${finalLineCount} segments | ${totalPromptTokens + totalCompletionTokens} total tokens`);

    return {
      storageKey,
      frameCount: prepared.frames.length,
      tokenUsage,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[transcript] FAILED for session ${sessionId}:`, errorMessage);
    if (error instanceof Error && error.stack) {
      console.error(`[transcript] Stack:`, error.stack);
    }
    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.status": "failed",
      "transcript.error": errorMessage,
    });
    throw error;
  }
}

/**
 * Process frames using the prompt-only approach (default).
 * The system prompt instructs the model to identify regions and output
 * separate JSONL lines per region with different detail levels.
 */
async function processWithPromptOnly(
  frames: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number }>
): Promise<{
  batchOutputs: string[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}> {
  const batches = createBatches(frames as any);
  console.log(`[transcript] Created ${batches.length} batch(es) [prompt-only mode]`);

  const batchOutputs: string[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (const batch of batches) {
    console.log(`[transcript] Processing batch ${batch.batchIndex} (${batch.frames.length} frames)...`);
    const visionFrames: VisionFrame[] = batch.frames.map((f) => ({
      buffer: f.buffer,
      capturedAt: f.capturedAt,
      screenIndex: f.screenIndex,
    }));

    const result = await analyzeFrameBatch(
      visionFrames,
      PROMPT_TRANSCRIPT_SYSTEM
    );

    console.log(`[transcript] Batch ${batch.batchIndex}: ${result.promptTokens} prompt + ${result.completionTokens} completion tokens`);
    console.log(`[transcript] Batch ${batch.batchIndex} raw output (first 500 chars):\n${result.text.substring(0, 500)}`);

    batchOutputs.push(result.text);
    totalPromptTokens += result.promptTokens;
    totalCompletionTokens += result.completionTokens;
  }

  return { batchOutputs, totalPromptTokens, totalCompletionTokens };
}

// High-priority regions use GPT-4o for maximum accuracy
const HIGH_PRIORITY_REGIONS = new Set(["ai_chat"]);
// Low-priority regions use GPT-4o-mini to save cost and get dedup'd
const LOW_PRIORITY_REGIONS = new Set(["editor", "terminal", "file_tree", "other"]);
// Max crops to batch together for same region type
const REGION_BATCH_SIZE = 3;
// Re-detect layout every N frames (IDE layouts rarely change mid-session)
const LAYOUT_REDETECT_INTERVAL = 60; // ~30s at 0.5s candidate interval
// Pixel-diff threshold for full-frame change that triggers layout re-detection
const LAYOUT_CHANGE_THRESHOLD = 0.15; // 15% pixel diff = likely app switch or resize

/**
 * Get the model to use for a given region type.
 * High-priority (ai_chat) → GPT-4o
 * Low-priority (editor, terminal, file_tree) → GPT-4o-mini
 * Browser → GPT-4o (may contain AI tools)
 */
function getModelForRegion(regionType: string): string {
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
async function processWithRegionDetection(
  frames: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number; width: number; height: number }>
): Promise<{
  batchOutputs: string[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}> {
  console.log(`[transcript] Processing ${frames.length} frames with region detection...`);

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

  // #5: Idle frame dropping — full-frame hash
  let lastFullFrameHash: number | null = null;
  let idleFramesSkipped = 0;

  // #3: Low-priority region dedup
  const lastRegionCropHash = new Map<string, number>();

  // #2: Region batching
  const pendingCrops = new Map<string, RegionCrop[]>();

  /**
   * Flush pending crops for a region type.
   * Uses Tesseract hybrid OCR for eligible regions (ai_chat, terminal, editor),
   * falling back to vision API when confidence is low.
   * Non-eligible regions go directly to vision API.
   */
  async function flushRegion(regionType: string) {
    const crops = pendingCrops.get(regionType);
    if (!crops || crops.length === 0) return;

    const regionPrompt = REGION_PROMPTS[regionType] || REGION_PROMPTS["other"];
    const model = getModelForRegion(regionType);
    const cropData = crops.map((c) => ({
      buffer: c.frame.buffer,
      capturedAt: c.frame.capturedAt,
      screenIndex: c.frame.screenIndex,
    }));

    console.log(
      `[transcript] Flushing ${crops.length} ${regionType} crop(s) via OCR engine (model fallback: ${model})`
    );

    // ocrRegionBatch handles Tesseract-first for eligible regions,
    // falls back to vision API for low-confidence or non-eligible regions
    const result = await ocrRegionBatch(
      cropData,
      regionType,
      regionPrompt,
      model
    );

    batchOutputs.push(result.text);
    totalPromptTokens += result.promptTokens;
    totalCompletionTokens += result.completionTokens;

    pendingCrops.set(regionType, []);
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
          console.log(
            `[transcript] Frame ${frameIndex + 1}: major visual change detected (${(diffRatio * 100).toFixed(1)}% diff), re-detecting layout`
          );
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
        console.log(
          `[transcript] Frame ${frameIndex + 1}: layout detected — ${regions.map((r) => r.regionType).join(", ")}`
        );
      } else if (cachedLayout) {
        // Detection returned nothing but we have a cache — keep using it
        console.log(
          `[transcript] Frame ${frameIndex + 1}: detection returned 0 regions, reusing cached layout`
        );
      }
      return cachedLayout || regions;
    }

    return cachedLayout;
  }

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

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
      // Flush any pending crops before fallback
      for (const regionType of pendingCrops.keys()) {
        await flushRegion(regionType);
      }
      console.log(
        `[transcript] Frame ${i + 1}: no layout available, using full-frame fallback`
      );
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

      // #2: Flush if batch is full
      if (pendingCrops.get(region.regionType)!.length >= REGION_BATCH_SIZE) {
        await flushRegion(region.regionType);
      }
    }
  }

  // Flush remaining crops
  for (const regionType of pendingCrops.keys()) {
    await flushRegion(regionType);
  }

  if (idleFramesSkipped > 0) {
    console.log(
      `[transcript] Skipped ${idleFramesSkipped} idle frames (full-frame hash match)`
    );
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
