/**
 * OpenAI vision API client for frame analysis.
 * Singleton pattern matching utils/embeddings.ts.
 * Model configurable via OPENAI_VISION_MODEL env var (default: gpt-4o).
 */

import OpenAI from "openai";

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
 * @returns Raw text output and token usage
 */
export async function analyzeFrameBatch(
  frames: VisionFrame[],
  systemPrompt: string
): Promise<VisionResult> {
  const client = getOpenAIClient();

  const imageMessages: OpenAI.Chat.ChatCompletionContentPart[] = [];

  // Add timestamp context
  const timestamps = frames.map(
    (f) =>
      `[Screen ${f.screenIndex} @ ${f.capturedAt.toISOString()}]`
  );

  imageMessages.push({
    type: "text",
    text: `Frames in this batch (${frames.length} frames):\n${timestamps.join("\n")}\n\nFor each screenshot, transcribe ALL visible text VERBATIM into the text_content field. Do NOT summarize or describe — copy the exact text you see character-for-character. Output one JSONL line per distinct activity period. The text_content field must contain the raw text, not a description of it.`,
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

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";
  console.log(`[vision] Calling ${model} with ${frames.length} images (${imageMessages.length} content parts)...`);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 16384,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: imageMessages },
    ],
  });

  const text = response.choices[0]?.message?.content || "";
  const finishReason = response.choices[0]?.finish_reason;
  const usage = response.usage;

  console.log(`[vision] Response: ${text.length} chars, finish_reason=${finishReason}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}`);
  if (!text) {
    console.error(`[vision] WARNING: Empty response from ${model}!`);
  }

  return {
    text,
    promptTokens: usage?.prompt_tokens || 0,
    completionTokens: usage?.completion_tokens || 0,
  };
}
