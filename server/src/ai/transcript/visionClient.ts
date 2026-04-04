/**
 * OpenAI vision API client for frame analysis.
 * Singleton pattern matching utils/embeddings.ts.
 * Model configurable via OPENAI_VISION_MODEL env var (default: gpt-4o).
 */

import OpenAI from "openai";
import { logTs } from "./logger.js";

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

// ---------------------------------------------------------------------------
// Concurrency limiter — prevents firing too many OpenAI calls at once.
// This is the primary rate-limit prevention mechanism. The retry logic below
// handles the cases that still slip through.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = parseInt(process.env.OPENAI_MAX_CONCURRENT || "2", 10);
let inFlight = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  // Wait for a slot to open up
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

/**
 * Run a function with concurrency limiting + retry with exponential backoff.
 * Acquires a concurrency slot before executing, retries on 429/5xx errors.
 * Respects the Retry-After header from OpenAI if present.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 5
): Promise<T> {
  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        const isRateLimit = status === 429;
        const isServerError = status >= 500 && status < 600;

        if ((isRateLimit || isServerError) && attempt < maxRetries) {
          // Check for Retry-After header
          const retryAfter = err?.headers?.["retry-after"];
          const baseDelay = retryAfter
            ? parseFloat(retryAfter) * 1000
            : Math.min(1000 * Math.pow(2, attempt), 30000);
          const jitter = Math.random() * 500;
          const delay = baseDelay + jitter;

          console.warn(
            `[${new Date().toISOString()}] [retry] ${label}: ${isRateLimit ? "rate limited (429)" : `server error (${status})`}, attempt ${attempt + 1}/${maxRetries}, waiting ${(delay / 1000).toFixed(1)}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`${label}: max retries exceeded`);
  } finally {
    releaseSlot();
  }
}

export interface VisionFrame {
  buffer: Buffer;
  capturedAt: Date;
  screenIndex: number;
}

export interface VisionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Analyze a batch of frame images using OpenAI vision API.
 * Each frame is sent as a base64-encoded image.
 *
 * @param frames - Array of frames with buffers
 * @param systemPrompt - System prompt for the vision model
 * @param regionContext - Optional region context for cropped region processing
 * @returns Raw text output and token usage
 */
export async function analyzeFrameBatch(
  frames: VisionFrame[],
  systemPrompt: string,
  regionContext?: { regionType: string },
  modelOverride?: string
): Promise<VisionResult> {
  const client = getOpenAIClient();

  const imageMessages: OpenAI.Chat.ChatCompletionContentPart[] = [];

  // Add timestamp context
  const timestamps = frames.map(
    (f) =>
      `[Screen ${f.screenIndex} @ ${f.capturedAt.toISOString()}]`
  );

  const regionNote = regionContext
    ? `\n\nThis is a CROPPED image showing ONLY the "${regionContext.regionType}" region. Focus exclusively on this region.`
    : "";

  imageMessages.push({
    type: "text",
    text: `Frames in this batch (${frames.length} frames):\n${timestamps.join("\n")}\n\nFor each screenshot, transcribe ALL visible text VERBATIM into the text_content field. Do NOT summarize or describe — copy the exact text you see character-for-character. Output one JSONL line per distinct activity period. The text_content field must contain the raw text, not a description of it.${regionNote}`,
  });

  // Add each frame as base64 image
  for (const frame of frames) {
    const base64 = frame.buffer.toString("base64");
    imageMessages.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${base64}`,
        detail: "high",
      },
    });
  }

  const model = modelOverride || process.env.OPENAI_VISION_MODEL || "gpt-4o";
  logTs("vision", `Calling ${model} with ${frames.length} images (${imageMessages.length} content parts)...`);

  const callStart = Date.now();
  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        max_tokens: 16384,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: imageMessages },
        ],
      }),
    `vision/${model}`
  );
  const elapsed = Date.now() - callStart;

  const text = response.choices[0]?.message?.content || "";
  const finishReason = response.choices[0]?.finish_reason;
  const usage = response.usage;

  logTs("vision", `Response: ${text.length} chars, finish_reason=${finishReason}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}`, elapsed);
  if (!text) {
    console.error(`[${new Date().toISOString()}] [vision] WARNING: Empty response from ${model}!`);
  }

  return {
    text,
    promptTokens: usage?.prompt_tokens || 0,
    completionTokens: usage?.completion_tokens || 0,
  };
}
