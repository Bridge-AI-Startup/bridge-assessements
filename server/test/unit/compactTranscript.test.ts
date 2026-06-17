import { describe, expect, it } from "vitest";

import { compactTranscriptForPrompt } from "../../src/services/evaluation/compactTranscript.js";
import type { TranscriptEvent } from "../../src/types/evaluation.js";

function ev(i: number, action: TranscriptEvent["action_type"], descLen = 50): TranscriptEvent {
  return {
    ts: i,
    ts_end: i + 1,
    action_type: action,
    ai_tool: action === "ai_prompt" ? "cursor" : null,
    prompt_text: action === "ai_prompt" ? "x".repeat(descLen) : null,
    search_query: null,
    description: `${action}-${i}-${"d".repeat(descLen)}`,
  };
}

describe("compactTranscriptForPrompt", () => {
  it("returns input unchanged when already small", () => {
    const events = [ev(0, "coding"), ev(1, "testing")];
    const out = compactTranscriptForPrompt(events, 100_000);
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(100_000);
  });

  it("handles empty input", () => {
    expect(compactTranscriptForPrompt([])).toEqual([]);
  });

  it("truncates long free-text fields", () => {
    const events = [ev(0, "coding", 5000)];
    const out = compactTranscriptForPrompt(events, 100_000);
    // description is truncated with an ellipsis marker
    expect(out[0].description.length).toBeLessThan(5000);
    expect(out[0].description.endsWith("…")).toBe(true);
  });

  it("downsamples a huge transcript to fit the char budget", () => {
    // 2000 events with large descriptions -> well over any sane budget.
    const events: TranscriptEvent[] = [];
    for (let i = 0; i < 2000; i++) {
      events.push(ev(i, i % 5 === 0 ? "ai_prompt" : "coding", 300));
    }
    const budget = 60_000;
    const out = compactTranscriptForPrompt(events, budget);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(budget);
    expect(out.length).toBeLessThan(events.length);
    // chronological order preserved
    for (let i = 1; i < out.length; i++) {
      expect(out[i].ts).toBeGreaterThanOrEqual(out[i - 1].ts);
    }
  });

  it("preserves high-signal AI events when downsampling", () => {
    const events: TranscriptEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      // a few AI prompts scattered among lots of coding
      events.push(ev(i, i % 200 === 0 ? "ai_prompt" : "coding", 400));
    }
    const out = compactTranscriptForPrompt(events, 40_000);
    const aiKept = out.filter((e) => e.action_type === "ai_prompt").length;
    const aiTotal = events.filter((e) => e.action_type === "ai_prompt").length;
    expect(aiKept).toBe(aiTotal); // all high-signal AI events retained
  });
});
