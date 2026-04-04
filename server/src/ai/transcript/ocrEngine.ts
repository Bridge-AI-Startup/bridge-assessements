/**
 * Hybrid OCR engine: Tesseract.js (local, free) with GPT-4o vision fallback.
 *
 * Strategy per region type:
 * - ai_chat, terminal, editor: Try Tesseract first. If confidence is high enough, use it.
 *   If confidence is low (blurry, small text, complex layout), fall back to vision API.
 * - browser, file_tree, other: Always use vision API (complex layouts Tesseract struggles with).
 *
 * Confidence thresholds are tuned per region since chat text is typically cleaner
 * than code with syntax highlighting.
 */

import Tesseract from "tesseract.js";
import { analyzeFrameBatch, VisionFrame, VisionResult } from "./visionClient.js";

// Regions eligible for Tesseract OCR
const TESSERACT_ELIGIBLE = new Set(["ai_chat", "terminal", "editor"]);

// Confidence thresholds per region type (0-100)
// Below this → fall back to vision API
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  ai_chat: 70,   // Chat text is usually clean, high contrast
  terminal: 65,  // Monospace, good contrast, but may have colored output
  editor: 60,    // Syntax highlighting and small text make it harder
};

// Minimum text length to consider Tesseract result valid
const MIN_TEXT_LENGTH = 10;

// Singleton worker for reuse across calls
let tesseractWorker: Tesseract.Worker | null = null;
let workerInitializing = false;
let workerInitPromise: Promise<Tesseract.Worker> | null = null;

/**
 * Get or create the Tesseract worker (singleton, lazy init).
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (tesseractWorker) return tesseractWorker;
  if (workerInitPromise) return workerInitPromise;

  workerInitializing = true;
  workerInitPromise = (async () => {
    console.log("[ocr] Initializing Tesseract worker...");
    const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY);
    tesseractWorker = worker;
    workerInitializing = false;
    console.log("[ocr] Tesseract worker ready");
    return worker;
  })();

  return workerInitPromise;
}

export interface OcrResult {
  text: string;
  confidence: number;
  method: "tesseract" | "vision_api";
  promptTokens: number;
  completionTokens: number;
}

/**
 * Run OCR on a cropped region image.
 * Tries Tesseract first for eligible regions, falls back to vision API if confidence is low.
 *
 * @param buffer - PNG image buffer of the cropped region
 * @param regionType - Type of region (ai_chat, terminal, editor, etc.)
 * @param capturedAt - Timestamp for the frame
 * @param screenIndex - Screen index
 * @param systemPrompt - System prompt for vision API fallback
 * @param modelOverride - Model override for vision API fallback
 */
export async function ocrRegion(
  buffer: Buffer,
  regionType: string,
  capturedAt: Date,
  screenIndex: number,
  systemPrompt: string,
  modelOverride?: string
): Promise<OcrResult> {
  // Only try Tesseract for eligible region types
  if (TESSERACT_ELIGIBLE.has(regionType)) {
    const tesseractResult = await tryTesseract(buffer, regionType);
    if (tesseractResult) {
      return tesseractResult;
    }
    // Tesseract failed or low confidence — fall through to vision API
  }

  // Vision API fallback
  const visionFrame: VisionFrame = { buffer, capturedAt, screenIndex };
  const result = await analyzeFrameBatch(
    [visionFrame],
    systemPrompt,
    { regionType },
    modelOverride
  );

  return {
    text: result.text,
    confidence: 100, // Vision API doesn't report confidence, assume high
    method: "vision_api",
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  };
}

/**
 * Batch OCR: process multiple crops of the same region type.
 * For Tesseract-eligible regions, runs each crop through Tesseract individually.
 * Crops that fail confidence threshold get batched and sent to vision API together.
 *
 * @returns Combined JSONL text output and token usage
 */
export async function ocrRegionBatch(
  crops: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number }>,
  regionType: string,
  systemPrompt: string,
  modelOverride?: string
): Promise<VisionResult> {
  if (!TESSERACT_ELIGIBLE.has(regionType)) {
    // Not eligible for Tesseract — send entire batch to vision API
    const frames: VisionFrame[] = crops.map((c) => ({
      buffer: c.buffer,
      capturedAt: c.capturedAt,
      screenIndex: c.screenIndex,
    }));
    return analyzeFrameBatch(frames, systemPrompt, { regionType }, modelOverride);
  }

  // Try Tesseract on each crop, collect failures for vision API batch
  const tesseractOutputs: string[] = [];
  const visionFallbackCrops: Array<{ buffer: Buffer; capturedAt: Date; screenIndex: number }> = [];
  let tesseractCount = 0;

  for (const crop of crops) {
    const result = await tryTesseract(crop.buffer, regionType);
    if (result) {
      // Format as JSONL line matching the expected output format
      const jsonlLine = JSON.stringify({
        ts: crop.capturedAt.toISOString(),
        screen: crop.screenIndex,
        region: regionType,
        app: regionType === "ai_chat" ? "AI Chat" : regionType === "terminal" ? "Terminal" : "Editor",
        text_content: result.text,
      });
      tesseractOutputs.push(jsonlLine);
      tesseractCount++;
    } else {
      visionFallbackCrops.push(crop);
    }
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let visionOutput = "";

  // Process vision fallback batch if any
  if (visionFallbackCrops.length > 0) {
    console.log(
      `[ocr] ${visionFallbackCrops.length}/${crops.length} crops fell back to vision API for ${regionType}`
    );
    const frames: VisionFrame[] = visionFallbackCrops.map((c) => ({
      buffer: c.buffer,
      capturedAt: c.capturedAt,
      screenIndex: c.screenIndex,
    }));
    const visionResult = await analyzeFrameBatch(
      frames,
      systemPrompt,
      { regionType },
      modelOverride
    );
    visionOutput = visionResult.text;
    totalPromptTokens = visionResult.promptTokens;
    totalCompletionTokens = visionResult.completionTokens;
  }

  if (tesseractCount > 0) {
    console.log(
      `[ocr] ${tesseractCount}/${crops.length} crops handled by Tesseract for ${regionType}`
    );
  }

  // Combine Tesseract JSONL lines + vision API output
  const allOutput = [...tesseractOutputs, visionOutput].filter(Boolean).join("\n");

  return {
    text: allOutput,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
  };
}

/**
 * Try Tesseract OCR on a single image buffer.
 * Returns OcrResult if confidence is above threshold, null otherwise.
 */
async function tryTesseract(
  buffer: Buffer,
  regionType: string
): Promise<OcrResult | null> {
  const threshold = CONFIDENCE_THRESHOLDS[regionType] ?? 70;

  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);

    const confidence = data.confidence;
    const text = data.text.trim();

    // Reject if confidence too low or text too short
    if (confidence < threshold || text.length < MIN_TEXT_LENGTH) {
      console.log(
        `[ocr] Tesseract ${regionType}: confidence=${confidence.toFixed(1)}% (threshold=${threshold}%), len=${text.length} — falling back to vision`
      );
      return null;
    }

    console.log(
      `[ocr] Tesseract ${regionType}: confidence=${confidence.toFixed(1)}%, len=${text.length} — accepted`
    );

    return {
      text,
      confidence,
      method: "tesseract",
      promptTokens: 0,
      completionTokens: 0,
    };
  } catch (err) {
    console.warn(`[ocr] Tesseract failed for ${regionType}:`, err);
    return null;
  }
}

/**
 * Shut down the Tesseract worker (call on process exit).
 */
export async function terminateOcrWorker(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
    workerInitPromise = null;
    console.log("[ocr] Tesseract worker terminated");
  }
}
