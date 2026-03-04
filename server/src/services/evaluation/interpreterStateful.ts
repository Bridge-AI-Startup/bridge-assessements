/**
 * Strategy B: Stateful-Sequential (1-pass, freeform context) Activity Interpreter
 *
 * Processes screen moments in sequential batches of ~10 moments each.
 * Each batch receives the full running summary from all prior batches,
 * giving the LLM complete temporal context to infer candidate behavior.
 *
 * The LLM outputs moment_range indices — timestamps are computed deterministically
 * in code via resolveEvents().
 */

import { jsonrepair } from "jsonrepair";
import { PROMPT_INTERPRET_BATCH_STATEFUL } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { prepareMomentsForLLM, type LLMMoment } from "./momentGrouper.js";
import { resolveEvents } from "./timestampNormalizer.js";
import type {
  ScreenMoment,
  EnrichedTranscript,
  EnrichedTranscriptEvent,
} from "../../types/evaluation.js";

const MOMENTS_PER_BATCH = 10;

interface RawBatchOutput {
  events: {
    moment_range: [number, number];
    behavioral_summary: string;
    intent: string;
    ai_tool: string | null;
  }[];
  running_summary: string;
}

/**
 * Run Strategy B: Stateful-Sequential interpretation.
 */
export async function interpretStateful(
  moments: ScreenMoment[]
): Promise<EnrichedTranscript> {
  const startTime = Date.now();
  let totalTokens = 0;
  let llmCalls = 0;

  if (moments.length === 0) {
    return {
      events: [],
      session_narrative: "",
      strategy: "stateful",
      processing_stats: { llm_calls: 0, total_tokens: 0, processing_time_ms: Date.now() - startTime },
    };
  }

  const llmMoments = prepareMomentsForLLM(moments);
  const batches = createBatches(llmMoments, MOMENTS_PER_BATCH);

  const allEvents: EnrichedTranscriptEvent[] = [];
  let runningSummary = "";

  for (let i = 0; i < batches.length; i++) {
    const batchMoments = batches[i];
    const output = await processBatch(
      batchMoments,
      runningSummary,
      i + 1,
    );
    llmCalls++;

    const enriched = resolveEvents(output.events, batchMoments);
    allEvents.push(...enriched);
    runningSummary = output.running_summary;
  }

  return {
    events: allEvents,
    session_narrative: runningSummary,
    strategy: "stateful",
    processing_stats: {
      llm_calls: llmCalls,
      total_tokens: totalTokens,
      processing_time_ms: Date.now() - startTime,
    },
  };
}

async function processBatch(
  moments: LLMMoment[],
  runningSummary: string,
  batchNumber: number,
): Promise<RawBatchOutput> {
  const momentsJson = JSON.stringify(moments, null, 2);

  const messages = [
    { role: "system" as const, content: PROMPT_INTERPRET_BATCH_STATEFUL.system },
    {
      role: "user" as const,
      content: PROMPT_INTERPRET_BATCH_STATEFUL.userTemplate(
        momentsJson,
        runningSummary,
        batchNumber,
      ),
    },
  ];

  const { content } = await createChatCompletion("activity_interpretation", messages, {
    provider: PROMPT_INTERPRET_BATCH_STATEFUL.provider,
    model: PROMPT_INTERPRET_BATCH_STATEFUL.model,
    temperature: 0.2,
    maxTokens: 2048,
    responseFormat: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(jsonrepair(content));
    const events = Array.isArray(parsed.events)
      ? parsed.events.map(coerceRawEvent).filter(Boolean) as RawBatchOutput["events"]
      : [];
    return {
      events,
      running_summary: typeof parsed.running_summary === "string" ? parsed.running_summary : runningSummary,
    };
  } catch {
    return { events: [], running_summary: runningSummary };
  }
}

/**
 * Coerce a raw LLM event into our expected shape, handling cases where the LLM
 * might still output ts/ts_end instead of moment_range.
 */
function coerceRawEvent(e: Record<string, unknown>): RawBatchOutput["events"][0] | null {
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

function createBatches(moments: LLMMoment[], batchSize: number): LLMMoment[][] {
  const batches: LLMMoment[][] = [];
  for (let i = 0; i < moments.length; i += batchSize) {
    batches.push(moments.slice(i, i + batchSize));
  }
  return batches;
}
