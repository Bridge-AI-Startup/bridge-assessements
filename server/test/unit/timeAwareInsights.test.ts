import { describe, expect, it } from "vitest";

import { coerceInsight } from "../../src/services/evaluation/timeAwareInsights.js";

describe("coerceInsight", () => {
  it("accepts valid insight objects", () => {
    const out = coerceInsight({
      ts: 120,
      ts_end: 200,
      insight_type: "debug_loop",
      observation: "From 120–200s, candidate fixed an off-by-one after pytest failure.",
      confidence: "high",
    });
    expect(out).toEqual({
      ts: 120,
      ts_end: 200,
      insight_type: "debug_loop",
      observation: "From 120–200s, candidate fixed an off-by-one after pytest failure.",
      confidence: "high",
    });
  });

  it("rejects invalid insight_type", () => {
    expect(
      coerceInsight({
        ts: 1,
        ts_end: 2,
        insight_type: "unknown",
        observation: "x",
        confidence: "high",
      })
    ).toBeNull();
  });

  it("rejects missing observation", () => {
    expect(
      coerceInsight({
        ts: 1,
        ts_end: 2,
        insight_type: "test_cycle",
        observation: "",
        confidence: "medium",
      })
    ).toBeNull();
  });

  it("clamps ts_end below ts", () => {
    const out = coerceInsight({
      ts: 50,
      ts_end: 40,
      insight_type: "test_cycle",
      observation: "Ran tests.",
      confidence: "low",
    });
    expect(out?.ts_end).toBe(50);
  });
});

describe("generateTemporalInsights empty input", () => {
  it("returns empty array without calling LLM when no events", async () => {
    const { generateTemporalInsights } = await import(
      "../../src/services/evaluation/timeAwareInsights.js"
    );
    const result = await generateTemporalInsights({
      events: [],
      session_narrative: "",
      strategy: "stateful",
      processing_stats: { llm_calls: 0, total_tokens: 0, processing_time_ms: 0 },
    });
    expect(result).toEqual([]);
  });
});
