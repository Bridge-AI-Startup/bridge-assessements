import { describe, expect, it } from "vitest";

import {
  buildEvaluationTranscript,
  enrichedToTranscriptEvent,
  inferActionTypeFromEnriched,
  insightToTranscriptEvent,
} from "../../src/services/evaluation/enrichedEvaluationAdapter.js";
import type {
  EnrichedTranscript,
  EnrichedTranscriptEvent,
  TemporalInsight,
} from "../../src/types/evaluation.js";

function enriched(partial: Partial<EnrichedTranscriptEvent>): EnrichedTranscriptEvent {
  return {
    ts: 10,
    ts_end: 20,
    behavioral_summary: "At 10–20s, candidate typed a function.",
    intent: "coding",
    regions_present: ["editor"],
    ai_tool: null,
    raw_regions: [{ region: "editor", text_content: "def foo():" }],
    ...partial,
  };
}

describe("inferActionTypeFromEnriched", () => {
  it("maps terminal regions to testing", () => {
    expect(
      inferActionTypeFromEnriched(
        enriched({ regions_present: ["terminal"], intent: "run tests" })
      )
    ).toBe("testing");
  });

  it("maps browser to searching", () => {
    expect(
      inferActionTypeFromEnriched(
        enriched({ regions_present: ["browser"], intent: "research docs" })
      )
    ).toBe("searching");
  });

  it("maps ai_chat user text to ai_prompt", () => {
    expect(
      inferActionTypeFromEnriched(
        enriched({
          regions_present: ["ai_chat"],
          raw_regions: [{ region: "ai_chat", text_content: "Human: fix my bug" }],
        })
      )
    ).toBe("ai_prompt");
  });
});

describe("enrichedToTranscriptEvent", () => {
  it("preserves timestamps and behavioral summary", () => {
    const e = enriched({ ts: 100, ts_end: 130 });
    const out = enrichedToTranscriptEvent(e);
    expect(out.ts).toBe(100);
    expect(out.ts_end).toBe(130);
    expect(out.description).toContain("10–20s");
    expect(out.action_type).toBe("coding");
  });
});

describe("insightToTranscriptEvent", () => {
  it("maps test_cycle to testing action", () => {
    const insight: TemporalInsight = {
      ts: 300,
      ts_end: 420,
      insight_type: "test_cycle",
      observation: "From 300–420s, candidate ran pytest three times.",
      confidence: "high",
    };
    const out = insightToTranscriptEvent(insight);
    expect(out.action_type).toBe("testing");
    expect(out.ts).toBe(300);
    expect(out.description).toContain("test cycle");
    expect(out.description).toContain("pytest");
  });
});

describe("buildEvaluationTranscript", () => {
  it("merges enriched events with raw high-signal OCR", () => {
    const jsonl = [
      JSON.stringify({
        ts: "2025-01-01T00:00:00.000Z",
        ts_end: "2025-01-01T00:00:05.000Z",
        region: "ai_chat",
        text_content: "Human: write the whole solution",
      }),
      JSON.stringify({
        ts: "2025-01-01T00:00:10.000Z",
        region: "editor",
        text_content: "def dispatcher():",
      }),
    ].join("\n");

    const enrichedTranscript: EnrichedTranscript = {
      events: [
        enriched({
          ts: 0,
          ts_end: 5,
          behavioral_summary: "At 0–5s, candidate asked AI for full solution.",
          regions_present: ["ai_chat"],
        }),
      ],
      session_narrative: "",
      strategy: "stateful",
      processing_stats: { llm_calls: 1, total_tokens: 0, processing_time_ms: 0 },
    };

    const insights: TemporalInsight[] = [
      {
        ts: 0,
        ts_end: 30,
        insight_type: "incremental_build",
        observation: "From 0–30s, candidate built dispatcher module incrementally.",
        confidence: "high",
      },
    ];

    const merged = buildEvaluationTranscript(jsonl, enrichedTranscript, insights);
    expect(merged.some((e) => e.action_type === "ai_prompt")).toBe(true);
    expect(merged.some((e) => e.description.includes("incremental build"))).toBe(true);
    expect(merged.some((e) => e.action_type === "coding")).toBe(true);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].ts).toBeGreaterThanOrEqual(merged[i - 1].ts);
    }
  });
});
