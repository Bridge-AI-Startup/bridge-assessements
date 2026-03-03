/**
 * Vision-based region detection for screen frames.
 * Uses GPT-4o-mini to detect UI panel bounding boxes, then sharp to crop.
 *
 * Gated behind TRANSCRIPT_REGION_DETECTION env var (default: "false").
 * When enabled, each frame is first analyzed for layout, then each region
 * is cropped and processed with a region-specific prompt.
 */

import OpenAI from "openai";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { VisionFrame, withRetry } from "./visionClient.js";
import { PROMPT_DETECT_REGIONS } from "../../prompts/regionPrompts.js";

// Singleton Tesseract worker for text sampling (shared with ocrEngine)
let sampleWorker: Tesseract.Worker | null = null;
let sampleWorkerPromise: Promise<Tesseract.Worker> | null = null;

async function getSampleWorker(): Promise<Tesseract.Worker> {
  if (sampleWorker) return sampleWorker;
  if (sampleWorkerPromise) return sampleWorkerPromise;
  sampleWorkerPromise = (async () => {
    const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY);
    sampleWorker = worker;
    return worker;
  })();
  return sampleWorkerPromise;
}

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export interface DetectedRegion {
  regionType: string;
  x: number; // percentage 0-100
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface CroppedRegion {
  regionType: string;
  buffer: Buffer;
  confidence: number;
}

/**
 * Check if region detection is enabled via env var.
 */
export function isRegionDetectionEnabled(): boolean {
  return process.env.TRANSCRIPT_REGION_DETECTION !== "false";
}

// ---------------------------------------------------------------------------
// Text strip sampling
// ---------------------------------------------------------------------------

/**
 * Sample text from horizontal strips of the image using Tesseract.
 * Returns text snippets with their approximate vertical position (as % of image height).
 * This gives the vision model semantic context to distinguish panels
 * (e.g. "$ npm run dev" = terminal, "Human: ..." = ai_chat, "import" = editor).
 */
async function sampleTextStrips(
  buffer: Buffer,
  imageWidth: number,
  imageHeight: number
): Promise<string> {
  const NUM_STRIPS = 5; // Sample 5 horizontal strips
  const STRIP_HEIGHT_PCT = 8; // Each strip is 8% of image height
  const strips: string[] = [];

  try {
    const worker = await getSampleWorker();

    for (let i = 0; i < NUM_STRIPS; i++) {
      // Evenly distribute strips across the image
      const yPct = 10 + i * (80 / (NUM_STRIPS - 1)); // 10% to 90%
      const topPx = Math.round((yPct / 100) * imageHeight);
      const heightPx = Math.round((STRIP_HEIGHT_PCT / 100) * imageHeight);

      // Clamp
      const clampedTop = Math.max(0, Math.min(topPx, imageHeight - heightPx));
      const clampedHeight = Math.min(heightPx, imageHeight - clampedTop);
      if (clampedHeight < 10) continue;

      const stripBuffer = await sharp(buffer)
        .extract({
          left: 0,
          top: clampedTop,
          width: imageWidth,
          height: clampedHeight,
        })
        .withMetadata({ density: 72 })
        .png()
        .toBuffer();

      const { data } = await worker.recognize(stripBuffer);
      const text = data.text.trim();
      if (text.length > 5) {
        // Truncate to first 150 chars to keep prompt small
        const snippet = text.length > 150 ? text.slice(0, 150) + "..." : text;
        strips.push(`[y≈${yPct.toFixed(0)}%] ${snippet}`);
      }
    }
  } catch (err) {
    console.warn("[regionDetector] Text sampling failed:", err);
  }

  return strips.length > 0
    ? `\n\nOCR text samples from horizontal strips (use to identify region types):\n${strips.join("\n")}`
    : "";
}

/**
 * Detect UI regions in a frame using GPT-4o-mini vision + Tesseract text hints.
 * Returns bounding boxes as percentages of image dimensions.
 *
 * Strategy: First OCR horizontal strips of the image to get text samples,
 * then send both the image and text hints to the vision model so it can
 * use semantic context (e.g. "$ command" = terminal, "Human:" = ai_chat)
 * to correctly classify panels.
 */
export async function detectRegions(
  frame: VisionFrame
): Promise<DetectedRegion[]> {
  const client = getOpenAIClient();
  const base64 = frame.buffer.toString("base64");

  const model = process.env.OPENAI_REGION_DETECTION_MODEL || "gpt-4o-mini";

  // Get image dimensions for text sampling
  let imgWidth = 1920;
  let imgHeight = 1080;
  try {
    const metadata = await sharp(frame.buffer).metadata();
    imgWidth = metadata.width || imgWidth;
    imgHeight = metadata.height || imgHeight;
  } catch {
    // use defaults
  }

  // Sample text from strips to help identify region types
  const textHints = await sampleTextStrips(frame.buffer, imgWidth, imgHeight);

  console.log(
    `[regionDetector] Detecting regions with ${model}` +
      `${textHints ? " (with text hints)" : ""}...`
  );

  try {
    const response = await withRetry(
      () =>
        client.chat.completions.create({
          model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: PROMPT_DETECT_REGIONS },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${base64}`,
                    detail: "auto",
                  },
                },
                {
                  type: "text",
                  text: `Identify the UI panels in this screenshot and return bounding boxes.${textHints}`,
                },
              ],
            },
          ],
        }),
      `regionDetect/${model}`
    );

    const text = response.choices[0]?.message?.content || "";
    const usage = response.usage;
    console.log(
      `[regionDetector] Detection response: ${text.length} chars, ${usage?.total_tokens} tokens`
    );

    // Parse JSON array from response
    const cleaned = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const regions: DetectedRegion[] = JSON.parse(cleaned);

    // Validate and filter
    const valid = regions.filter(
      (r) =>
        r.regionType &&
        typeof r.x === "number" &&
        typeof r.y === "number" &&
        typeof r.width === "number" &&
        typeof r.height === "number" &&
        r.width > 2 &&
        r.height > 2
    );

    console.log(
      `[regionDetector] Found ${valid.length} regions: ${valid.map((r) => `${r.regionType}(${r.confidence})`).join(", ")}`
    );

    return valid;
  } catch (err) {
    console.error("[regionDetector] Detection failed:", err);
    return [];
  }
}

/**
 * Crop detected regions from a frame buffer using sharp.
 * Converts percentage-based bounding boxes to pixel coordinates.
 */
export async function cropRegions(
  buffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  regions: DetectedRegion[]
): Promise<CroppedRegion[]> {
  const cropped: CroppedRegion[] = [];

  for (const region of regions) {
    try {
      // Convert percentages to pixels
      const left = Math.round((region.x / 100) * imageWidth);
      const top = Math.round((region.y / 100) * imageHeight);
      const width = Math.round((region.width / 100) * imageWidth);
      const height = Math.round((region.height / 100) * imageHeight);

      // Clamp to image bounds
      const clampedLeft = Math.max(0, Math.min(left, imageWidth - 1));
      const clampedTop = Math.max(0, Math.min(top, imageHeight - 1));
      const clampedWidth = Math.min(width, imageWidth - clampedLeft);
      const clampedHeight = Math.min(height, imageHeight - clampedTop);

      if (clampedWidth < 10 || clampedHeight < 10) {
        console.warn(
          `[regionDetector] Skipping tiny region ${region.regionType}: ${clampedWidth}x${clampedHeight}`
        );
        continue;
      }

      const croppedBuffer = await sharp(buffer)
        .extract({
          left: clampedLeft,
          top: clampedTop,
          width: clampedWidth,
          height: clampedHeight,
        })
        .withMetadata({ density: 72 })
        .png()
        .toBuffer();

      cropped.push({
        regionType: region.regionType,
        buffer: croppedBuffer,
        confidence: region.confidence ?? 0.5,
      });
    } catch (err) {
      console.warn(
        `[regionDetector] Failed to crop region ${region.regionType}:`,
        err
      );
    }
  }

  return cropped;
}
