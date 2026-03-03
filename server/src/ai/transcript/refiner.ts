/**
 * Transcript refiner — AI post-processing layer.
 *
 * Takes raw OCR transcript (JSONL with text_content fields full of OCR artifacts)
 * and produces a clean, human-readable transcript with description fields.
 *
 * Uses GPT-4o for high-quality interpretation of noisy OCR text.
 * Handles long transcripts via chunking with context overlap for continuity.
 */

import OpenAI from "openai";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "../../services/capture/storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import { withRetry } from "./visionClient.js";
import { PROMPT_REFINE_TRANSCRIPT } from "../../prompts/refinerPrompts.js";

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
// Chunking config
// ---------------------------------------------------------------------------

// Max segments per chunk sent to the model.
// GPT-4o handles ~128k tokens; each segment is roughly 200-500 tokens of input
// plus ~50-100 tokens of output. 40 segments ≈ 15-20k input tokens — safe margin.
const CHUNK_SIZE = 40;

// Number of segments to overlap between chunks for context continuity.
const CHUNK_OVERLAP = 5;

// Number of previous descriptions to pass as context to the next chunk.
const CONTEXT_CARRY = 3;

export interface RefinedSegment {
  ts: string | number;
  ts_end?: string | number;
  description: string;
}

export interface RefineResult {
  storageKey: string;
  segmentCount: number;
  tokenUsage: { prompt: number; completion: number; total: number };
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

interface RawSegment {
  ts: string;
  ts_end?: string;
  screen?: number;
  region?: string;
  app?: string;
  text_content?: string;
  description?: string;
  event_type?: string;
}

/**
 * Split raw segments into overlapping chunks for processing.
 * Each chunk gets CHUNK_OVERLAP segments from the end of the previous chunk
 * prepended so the model has continuity context.
 */
function chunkSegments(segments: RawSegment[]): RawSegment[][] {
  if (segments.length <= CHUNK_SIZE) {
    return [segments];
  }

  const chunks: RawSegment[][] = [];
  let start = 0;

  while (start < segments.length) {
    const end = Math.min(start + CHUNK_SIZE, segments.length);
    chunks.push(segments.slice(start, end));
    start = end - CHUNK_OVERLAP; // overlap
    if (start >= segments.length) break;
    // Prevent infinite loop if overlap >= chunk size
    if (end === segments.length) break;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// AI refinement
// ---------------------------------------------------------------------------

/**
 * Refine a single chunk of raw segments using GPT-4o.
 * Returns cleaned, merged, deduplicated descriptions.
 */
async function refineChunk(
  segments: RawSegment[],
  previousContext: string[],
  chunkIndex: number,
  totalChunks: number
): Promise<{ refined: RefinedSegment[]; promptTokens: number; completionTokens: number }> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_REFINER_MODEL || "gpt-4o";

  // Build user message with segments and optional context
  const input: any = {
    segments: segments.map((s) => ({
      ts: s.ts,
      ts_end: s.ts_end,
      region: s.region,
      app: s.app,
      text_content: s.text_content || s.description || "",
    })),
  };

  if (previousContext.length > 0) {
    input.previous_context = previousContext;
  }

  console.log(
    `[refiner] Processing chunk ${chunkIndex + 1}/${totalChunks}: ${segments.length} segments` +
      (previousContext.length > 0 ? ` (with ${previousContext.length} context descriptions)` : "")
  );

  const response = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        max_tokens: 8192,
        temperature: 0.2,
        messages: [
          { role: "system", content: PROMPT_REFINE_TRANSCRIPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    `refiner/${model}`
  );

  const text = response.choices[0]?.message?.content || "";
  const usage = response.usage;

  console.log(
    `[refiner] Chunk ${chunkIndex + 1}: ${text.length} chars, ${usage?.total_tokens} tokens`
  );

  // Parse JSON array from response
  try {
    const cleaned = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed: RefinedSegment[] = JSON.parse(cleaned);

    // Validate
    const valid = parsed.filter(
      (s) => s.ts !== undefined && typeof s.description === "string" && s.description.length > 0
    );

    return {
      refined: valid,
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
    };
  } catch (err) {
    console.error(`[refiner] Failed to parse chunk ${chunkIndex + 1} output:`, text.substring(0, 500));
    throw new Error(`Refiner output parsing failed for chunk ${chunkIndex + 1}`);
  }
}

// ---------------------------------------------------------------------------
// Deduplication across chunks
// ---------------------------------------------------------------------------

/**
 * Deduplicate refined segments from overlapping chunks.
 * When two chunks overlap in timestamp range, keep the version from the later chunk
 * (which had better context from the overlap).
 */
function deduplicateRefined(allSegments: RefinedSegment[]): RefinedSegment[] {
  if (allSegments.length === 0) return [];

  // Sort by timestamp
  allSegments.sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : new Date(a.ts).getTime();
    const tb = typeof b.ts === "number" ? b.ts : new Date(b.ts).getTime();
    return ta - tb;
  });

  // Remove duplicates with same ts
  const seen = new Map<string, RefinedSegment>();
  for (const seg of allSegments) {
    const key = String(seg.ts);
    // Later entries (from later chunks with better context) overwrite earlier ones
    seen.set(key, seg);
  }

  return Array.from(seen.values()).sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : new Date(a.ts).getTime();
    const tb = typeof b.ts === "number" ? b.ts : new Date(b.ts).getTime();
    return ta - tb;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Refine a raw transcript into clean human-readable descriptions.
 * Reads the raw JSONL transcript from storage, processes through GPT-4o,
 * and stores the refined version alongside the original.
 */
export async function refineTranscript(sessionId: string): Promise<RefineResult> {
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  if (session.transcript.status !== "completed" || !session.transcript.storageKey) {
    throw new Error("Raw transcript must be generated before refining");
  }

  // Mark as refining
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.refinedStatus": "generating",
    "transcript.refinedError": null,
  });

  try {
    // Load raw transcript
    const storage = getFrameStorage();
    const rawContent = await storage.getTranscript(session.transcript.storageKey);

    // Parse JSONL into segments
    const rawSegments: RawSegment[] = rawContent
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      // Sort chronologically
      .sort((a, b) => {
        const ta = new Date(a.ts).getTime();
        const tb = new Date(b.ts).getTime();
        return ta - tb;
      });

    console.log(`[refiner] Loaded ${rawSegments.length} raw segments for session ${sessionId}`);

    if (rawSegments.length === 0) {
      throw new Error("No raw transcript segments to refine");
    }

    // Chunk the segments
    const chunks = chunkSegments(rawSegments);
    console.log(
      `[refiner] Split into ${chunks.length} chunk(s) (${CHUNK_SIZE} segments/chunk, ${CHUNK_OVERLAP} overlap)`
    );

    // Process each chunk
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const allRefined: RefinedSegment[] = [];
    let previousContext: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const result = await refineChunk(chunks[i], previousContext, i, chunks.length);
      allRefined.push(...result.refined);
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      // Carry forward the last CONTEXT_CARRY descriptions for next chunk
      previousContext = result.refined
        .slice(-CONTEXT_CARRY)
        .map((s) => s.description);
    }

    // Deduplicate across chunk overlaps
    const deduplicated = deduplicateRefined(allRefined);
    console.log(
      `[refiner] ${allRefined.length} total refined → ${deduplicated.length} after dedup`
    );

    // Store as JSONL
    const refinedJsonl = deduplicated.map((s) => JSON.stringify(s)).join("\n");
    const refinedKey = `${sessionId}/transcript_refined.jsonl`;
    await storage.storeTranscript(refinedKey, refinedJsonl);

    const tokenUsage = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    // Update session
    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.refinedStatus": "completed",
      "transcript.refinedStorageKey": refinedKey,
      "transcript.refinedAt": new Date(),
      "transcript.refinedTokenUsage": tokenUsage,
    });

    console.log(
      `[refiner] Done! ${rawSegments.length} raw → ${deduplicated.length} refined segments | ${tokenUsage.total} tokens`
    );

    return {
      storageKey: refinedKey,
      segmentCount: deduplicated.length,
      tokenUsage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[refiner] FAILED for session ${sessionId}:`, errorMessage);
    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.refinedStatus": "failed",
      "transcript.refinedError": errorMessage,
    });
    throw error;
  }
}
