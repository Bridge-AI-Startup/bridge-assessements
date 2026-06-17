/**
 * Second-pass temporal insight generation over enriched transcript events.
 */

import { jsonrepair } from "jsonrepair";
import { PROMPT_GENERATE_TEMPORAL_INSIGHTS } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import type {
  EnrichedTranscript,
  TemporalInsight,
  TemporalInsightType,
} from "../../types/evaluation.js";

const INSIGHT_TYPES: ReadonlySet<string> = new Set([
  "incremental_build",
  "test_cycle",
  "debug_loop",
  "ai_usage",
  "research",
  "workflow_transition",
]);

const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

const EVENTS_PER_CHUNK = 60;

/**
 * Generate time-aware insights from an enriched transcript.
 * Chunks long sessions into multiple LLM calls and merges results.
 */
export async function generateTemporalInsights(
  enriched: EnrichedTranscript
): Promise<TemporalInsight[]> {
  const events = enriched.events ?? [];
  if (events.length === 0) return [];

  if (events.length <= EVENTS_PER_CHUNK) {
    return generateInsightsForChunk(events);
  }

  const all: TemporalInsight[] = [];
  for (let i = 0; i < events.length; i += EVENTS_PER_CHUNK) {
    const chunk = events.slice(i, i + EVENTS_PER_CHUNK);
    const insights = await generateInsightsForChunk(chunk);
    all.push(...insights);
  }
  return dedupeInsights(all);
}

async function generateInsightsForChunk(
  events: EnrichedTranscript["events"]
): Promise<TemporalInsight[]> {
  const compact = events.map((e) => ({
    ts: e.ts,
    ts_end: e.ts_end,
    behavioral_summary: e.behavioral_summary,
    intent: e.intent,
    regions_present: e.regions_present,
  }));
  const eventsJson = JSON.stringify(compact, null, 2);

  const messages = [
    { role: "system" as const, content: PROMPT_GENERATE_TEMPORAL_INSIGHTS.system },
    {
      role: "user" as const,
      content: PROMPT_GENERATE_TEMPORAL_INSIGHTS.userTemplate(eventsJson, compact.length),
    },
  ];

  const { content } = await createChatCompletion("temporal_insights", messages, {
    provider: PROMPT_GENERATE_TEMPORAL_INSIGHTS.provider,
    model: PROMPT_GENERATE_TEMPORAL_INSIGHTS.model,
    temperature: 0.2,
    maxTokens: 4096,
    responseFormat: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(jsonrepair(content)) as { insights?: unknown[] };
    if (!Array.isArray(parsed.insights)) return [];
    return parsed.insights.map(coerceInsight).filter(Boolean) as TemporalInsight[];
  } catch {
    return [];
  }
}

export function coerceInsight(raw: unknown): TemporalInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ts = typeof o.ts === "number" ? o.ts : null;
  const ts_end = typeof o.ts_end === "number" ? o.ts_end : null;
  const observation = typeof o.observation === "string" ? o.observation.trim() : "";
  if (ts == null || ts_end == null || !observation) return null;

  const insightType = String(o.insight_type || "");
  const confidence = String(o.confidence || "medium");
  if (!INSIGHT_TYPES.has(insightType)) return null;
  if (!CONFIDENCE_LEVELS.has(confidence)) return null;

  return {
    ts: Math.max(0, ts),
    ts_end: Math.max(ts, ts_end),
    insight_type: insightType as TemporalInsightType,
    observation,
    confidence: confidence as TemporalInsight["confidence"],
  };
}

function dedupeInsights(insights: TemporalInsight[]): TemporalInsight[] {
  const seen = new Set<string>();
  const out: TemporalInsight[] = [];
  for (const ins of insights.sort((a, b) => a.ts - b.ts)) {
    const key = `${ins.insight_type}:${ins.ts}:${ins.ts_end}:${ins.observation.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ins);
  }
  return out;
}
