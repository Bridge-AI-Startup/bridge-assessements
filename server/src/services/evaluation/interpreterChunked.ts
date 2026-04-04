/**
 * Strategy A: LLM-Chunked (2-pass, parallelizable) Activity Interpreter
 *
 * Pass 1: Detect activity boundaries from a compact moment index (1 LLM call).
 * Pass 2: Interpret each chunk with full moment data + prior summary (N sequential calls).
 * Assembly: Stitch enriched chunks into the final EnrichedTranscript.
 *
 * The LLM outputs moment_range indices — timestamps are computed deterministically
 * in code via resolveEvents().
 */

import { jsonrepair } from "jsonrepair";
import {
  PROMPT_DETECT_ACTIVITY_BOUNDARIES,
  PROMPT_INTERPRET_CHUNK,
} from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { buildCompactIndex, prepareMomentsForLLM, type LLMMoment } from "./momentGrouper.js";
import { resolveEvents } from "./timestampNormalizer.js";
import {
  activityBoundariesSchema,
  type ActivityBoundariesSchema,
} from "../schemas/evaluation.js";
import type {
  ScreenMoment,
  EnrichedTranscript,
  EnrichedTranscriptEvent,
} from "../../types/evaluation.js";

interface RawChunkInterpretation {
  events: {
    moment_range: [number, number];
    behavioral_summary: string;
    intent: string;
    ai_tool: string | null;
  }[];
  chunk_summary: string;
}

/**
 * Run Strategy A: LLM-Chunked interpretation.
 */
export async function interpretChunked(
  moments: ScreenMoment[]
): Promise<EnrichedTranscript> {
  const startTime = Date.now();
  let totalTokens = 0;
  let llmCalls = 0;

  if (moments.length === 0) {
    return emptyResult(startTime);
  }

  const llmMoments = prepareMomentsForLLM(moments);

  // Pass 1: Detect activity boundaries
  const compactIndex = buildCompactIndex(llmMoments);
  const boundaries = await detectBoundaries(compactIndex, llmMoments.length);
  llmCalls++;

  // Pass 2: Interpret each chunk sequentially (each gets prior summary)
  const allEvents: EnrichedTranscriptEvent[] = [];
  let runningSummary = "";

  for (const chunk of boundaries.chunks) {
    const chunkMoments = llmMoments.slice(chunk.start_moment, chunk.end_moment + 1);
    const interpretation = await interpretSingleChunk(
      chunk.label,
      chunkMoments,
      runningSummary,
    );
    llmCalls++;

    const enriched = resolveEvents(interpretation.events, chunkMoments);
    allEvents.push(...enriched);

    runningSummary = runningSummary
      ? `${runningSummary} ${interpretation.chunk_summary}`
      : interpretation.chunk_summary;
  }

  return {
    events: allEvents,
    session_narrative: runningSummary,
    strategy: "chunked",
    processing_stats: {
      llm_calls: llmCalls,
      total_tokens: totalTokens,
      processing_time_ms: Date.now() - startTime,
    },
  };
}

async function detectBoundaries(
  compactIndex: string,
  totalMoments: number
): Promise<ActivityBoundariesSchema> {
  const messages = [
    { role: "system" as const, content: PROMPT_DETECT_ACTIVITY_BOUNDARIES.system },
    {
      role: "user" as const,
      content: PROMPT_DETECT_ACTIVITY_BOUNDARIES.userTemplate(compactIndex, totalMoments),
    },
  ];

  const { content } = await createChatCompletion("activity_interpretation", messages, {
    provider: PROMPT_DETECT_ACTIVITY_BOUNDARIES.provider,
    model: PROMPT_DETECT_ACTIVITY_BOUNDARIES.model,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(jsonrepair(content));
    return activityBoundariesSchema.parse(parsed);
  } catch {
    return {
      chunks: [{ start_moment: 0, end_moment: totalMoments - 1, label: "full session" }],
    };
  }
}

async function interpretSingleChunk(
  chunkLabel: string,
  moments: LLMMoment[],
  priorSummary: string,
): Promise<RawChunkInterpretation> {
  const momentsJson = JSON.stringify(moments, null, 2);

  const messages = [
    { role: "system" as const, content: PROMPT_INTERPRET_CHUNK.system },
    {
      role: "user" as const,
      content: PROMPT_INTERPRET_CHUNK.userTemplate(
        chunkLabel,
        momentsJson,
        priorSummary,
      ),
    },
  ];

  const { content } = await createChatCompletion("activity_interpretation", messages, {
    provider: PROMPT_INTERPRET_CHUNK.provider,
    model: PROMPT_INTERPRET_CHUNK.model,
    temperature: 0.2,
    maxTokens: 2048,
    responseFormat: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(jsonrepair(content));
    const events = Array.isArray(parsed.events)
      ? parsed.events.map(coerceRawEvent).filter(Boolean) as RawChunkInterpretation["events"]
      : [];
    return {
      events,
      chunk_summary: typeof parsed.chunk_summary === "string" ? parsed.chunk_summary : "",
    };
  } catch {
    return { events: [], chunk_summary: "" };
  }
}

/**
 * Coerce a raw LLM event into our expected shape, handling cases where the LLM
 * might still output ts/ts_end instead of moment_range.
 */
function coerceRawEvent(e: Record<string, unknown>): RawChunkInterpretation["events"][0] | null {
  let momentRange: [number, number];

  if (Array.isArray(e.moment_range) && e.moment_range.length >= 2) {
    momentRange = [Number(e.moment_range[0]), Number(e.moment_range[1])];
  } else if (typeof e.start_moment === "number" && typeof e.end_moment === "number") {
    momentRange = [e.start_moment, e.end_moment];
  } else {
    return null;
  }

  return {
    moment_range: momentRange,
    behavioral_summary: String(e.behavioral_summary || ""),
    intent: String(e.intent || ""),
    ai_tool: typeof e.ai_tool === "string" ? e.ai_tool : null,
  };
}

function emptyResult(startTime: number): EnrichedTranscript {
  return {
    events: [],
    session_narrative: "",
    strategy: "chunked",
    processing_stats: { llm_calls: 0, total_tokens: 0, processing_time_ms: Date.now() - startTime },
  };
}
