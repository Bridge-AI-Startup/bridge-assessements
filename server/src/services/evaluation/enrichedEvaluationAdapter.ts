/**
 * Merge enriched transcript events, temporal insights, and selective raw OCR
 * into TranscriptEvent[] for the evaluation pipeline.
 */

import { proctoringJsonlToTranscriptEvents } from "./proctoringTranscriptAdapter.js";
import type {
  ActionType,
  EnrichedTranscriptEvent,
  TemporalInsight,
  TemporalInsightType,
  TranscriptEvent,
  EnrichedTranscript,
} from "../../types/evaluation.js";

const HIGH_SIGNAL_RAW: ReadonlySet<ActionType> = new Set([
  "ai_prompt",
  "ai_response",
  "searching",
]);

function mapAiTool(tool: string | null): TranscriptEvent["ai_tool"] {
  if (!tool) return null;
  const lower = tool.toLowerCase();
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("chatgpt")) return "chatgpt";
  if (lower.includes("copilot")) return "copilot";
  return null;
}

/** Infer action_type from enriched event intent and regions. */
export function inferActionTypeFromEnriched(event: EnrichedTranscriptEvent): ActionType {
  const intent = (event.intent || "").toLowerCase();
  const regions = (event.regions_present || []).map((r) => r.toLowerCase());

  if (regions.includes("browser") || intent.includes("research") || intent.includes("browse")) {
    return "searching";
  }
  if (
    regions.includes("ai_chat") ||
    event.ai_tool ||
    intent.includes("ai") ||
    intent.includes("chatgpt") ||
    intent.includes("copilot") ||
    intent.includes("cursor")
  ) {
    const aiRegion = event.raw_regions?.find((r) => r.region === "ai_chat");
    const text = (aiRegion?.text_content || "").trim();
    if (/^(Assistant|Agent|AI):/im.test(text)) return "ai_response";
    if (/^(Human|User):/im.test(text)) return "ai_prompt";
    return "ai_prompt";
  }
  if (
    regions.includes("terminal") ||
    /\b(pytest|ruff|test|lint|terminal|debug)\b/i.test(intent) ||
    /\b(pytest|ruff|FAIL|PASS)\b/i.test(event.behavioral_summary)
  ) {
    return "testing";
  }
  if (regions.includes("file_tree") || intent.includes("read") || intent.includes("spec")) {
    return "reading";
  }
  if (intent.includes("idle") || intent.includes("pause")) {
    return "idle";
  }
  return "coding";
}

function extractPromptText(event: EnrichedTranscriptEvent): string | null {
  const aiRegion = event.raw_regions?.find((r) => r.region === "ai_chat");
  if (!aiRegion) return null;
  const match = aiRegion.text_content.match(
    /^(?:Human|User):\s*([\s\S]*?)(?=(?:Assistant|Agent|AI):|$)/im
  );
  return match ? match[1].trim() : null;
}

/** Convert one enriched event to a TranscriptEvent. */
export function enrichedToTranscriptEvent(event: EnrichedTranscriptEvent): TranscriptEvent {
  const action_type = inferActionTypeFromEnriched(event);
  return {
    ts: event.ts,
    ts_end: event.ts_end,
    action_type,
    ai_tool: mapAiTool(event.ai_tool),
    prompt_text: action_type === "ai_prompt" ? extractPromptText(event) : null,
    search_query: action_type === "searching" ? event.behavioral_summary.slice(0, 200) : null,
    description: event.behavioral_summary,
  };
}

const INSIGHT_ACTION: Record<TemporalInsightType, ActionType> = {
  incremental_build: "coding",
  test_cycle: "testing",
  debug_loop: "testing",
  ai_usage: "ai_prompt",
  research: "searching",
  workflow_transition: "reading",
};

/** Convert a temporal insight into a high-signal TranscriptEvent. */
export function insightToTranscriptEvent(insight: TemporalInsight): TranscriptEvent {
  const action_type = INSIGHT_ACTION[insight.insight_type] ?? "coding";
  const prefix = `[${insight.insight_type.replace(/_/g, " ")}] `;
  return {
    ts: insight.ts,
    ts_end: insight.ts_end,
    action_type,
    ai_tool: null,
    prompt_text: null,
    search_query: insight.insight_type === "research" ? insight.observation.slice(0, 200) : null,
    description: prefix + insight.observation,
  };
}

function extractHighSignalRawEvents(jsonl: string): TranscriptEvent[] {
  return proctoringJsonlToTranscriptEvents(jsonl).filter((e) =>
    HIGH_SIGNAL_RAW.has(e.action_type)
  );
}

/**
 * Build hybrid evaluation transcript: enriched behavioral events + raw AI/browser OCR
 * + temporal insight events.
 */
export function buildEvaluationTranscript(
  rawJsonl: string,
  enriched: EnrichedTranscript,
  insights: TemporalInsight[]
): TranscriptEvent[] {
  const enrichedEvents = (enriched.events ?? []).map(enrichedToTranscriptEvent);
  const rawHighSignal = extractHighSignalRawEvents(rawJsonl);
  const insightEvents = insights.map(insightToTranscriptEvent);

  const merged = [...enrichedEvents, ...rawHighSignal, ...insightEvents];
  merged.sort((a, b) => a.ts - b.ts || a.ts_end - b.ts_end);
  return merged;
}
