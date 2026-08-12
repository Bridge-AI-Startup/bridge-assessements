import { describe, it, expect } from "vitest";
import {
  validateCriterionEvidence,
  validateAllEvidence,
} from "../../src/services/workflowCapture/evidenceValidator.js";
import { buildEventIndex } from "../../src/services/workflowCapture/episodes.js";
import type { TranscriptEvent } from "../../src/types/evaluation.js";

const timeline: TranscriptEvent[] = [
  { ts: 10, ts_end: 20, action_type: "ai_prompt", ai_tool: "claude", prompt_text: "explain the failure", search_query: null, description: "prompted" },
  { ts: 40, ts_end: 55, action_type: "testing", ai_tool: null, prompt_text: null, search_query: null, description: "npm test" },
  { ts: 100, ts_end: 120, action_type: "coding", ai_tool: null, prompt_text: null, search_query: null, description: "wrote summary.js" },
];

const verdict = (evidence: any[], extra: Partial<any> = {}) => ({
  criterion: "critical thinking",
  score: 8,
  confidence: "high" as const,
  verdict: "Diagnosed before changing code.",
  evidence,
  evaluable: true,
  ...extra,
});

describe("validateCriterionEvidence", () => {
  it("keeps citations that land near captured activity", () => {
    const out = validateCriterionEvidence(
      verdict([{ ts: 12, observation: "asked for the root cause first" }]),
      timeline
    );
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(0);
    expect(out.result.evaluable).toBe(true);
  });

  it("drops a citation pointing at a moment with no captured activity", () => {
    // 600s is well past anything in the timeline — a fabricated timestamp
    const out = validateCriterionEvidence(
      verdict([
        { ts: 12, observation: "real moment" },
        { ts: 600, observation: "invented moment" },
      ]),
      timeline
    );
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
    expect(out.reasons.join(" ")).toMatch(/beyond the session|nothing captured/);
  });

  it("invalidates a verdict when most of its support is fabricated", () => {
    const out = validateCriterionEvidence(
      verdict([
        { ts: 12, observation: "real" },
        { ts: 500, observation: "invented" },
        { ts: 700, observation: "invented" },
      ]),
      timeline
    );
    expect(out.invalidated).toBe(true);
    // a score nothing stands behind must not be presented as evaluable
    expect(out.result.evaluable).toBe(false);
    expect(out.result.verdict).toMatch(/Withheld/);
  });

  it("rejects citations with no observation text", () => {
    const out = validateCriterionEvidence(
      verdict([{ ts: 12, observation: "   " }]),
      timeline
    );
    expect(out.kept).toBe(0);
    expect(out.reasons.join(" ")).toMatch(/no observation/);
  });

  it("rejects malformed timestamps", () => {
    const out = validateCriterionEvidence(
      verdict([
        { ts: -5, observation: "negative" },
        { ts: NaN, observation: "not a number" },
      ]),
      timeline
    );
    expect(out.kept).toBe(0);
    expect(out.dropped).toBe(2);
  });

  it("tolerates a citation slightly off an exact event boundary", () => {
    // judge cites 33s; nearest event ends at 20s — within tolerance
    const out = validateCriterionEvidence(
      verdict([{ ts: 33, observation: "between events" }]),
      timeline
    );
    expect(out.kept).toBe(1);
  });

  it("leaves an already-unsupported verdict non-evaluable", () => {
    const out = validateCriterionEvidence(verdict([]), timeline);
    expect(out.result.evaluable).toBe(false);
  });
});

describe("validateAllEvidence", () => {
  it("reports which criteria were invalidated across a set", () => {
    const out = validateAllEvidence(
      [
        verdict([{ ts: 12, observation: "real" }], { criterion: "good one" }),
        verdict(
          [
            { ts: 800, observation: "invented" },
            { ts: 900, observation: "invented" },
          ],
          { criterion: "bad one" }
        ),
      ],
      timeline
    );
    expect(out.totalKept).toBe(1);
    expect(out.totalDropped).toBe(2);
    expect(out.invalidatedCriteria).toEqual(["bad one"]);
  });
});

describe("buildEventIndex", () => {
  const T0 = new Date("2026-08-12T10:00:00Z");
  const mkEvents = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      at: new Date(T0.getTime() + i * 1000),
      type: "user_prompt",
      text: `prompt number ${i}`,
    }));

  it("emits one line per event with its index and offset", () => {
    const { text, usedIndices } = buildEventIndex(mkEvents(3), T0);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("0\t0s\tuser_prompt")).toBe(true);
    expect(usedIndices).toEqual([0, 1, 2]);
  });

  it("samples across a long session instead of truncating the tail", () => {
    const { usedIndices } = buildEventIndex(mkEvents(2000), T0);
    expect(usedIndices.length).toBeLessThanOrEqual(400);
    // the end of the session must still be represented, or episodes would only
    // ever describe the opening minutes
    expect(Math.max(...usedIndices)).toBeGreaterThan(1500);
  });

  it("truncates long event text so one event cannot dominate the prompt", () => {
    const long = [{ at: T0, type: "assistant_message", text: "x".repeat(5000) }];
    const { text } = buildEventIndex(long, T0);
    expect(text.length).toBeLessThan(400);
    expect(text).toMatch(/…$/);
  });
});
