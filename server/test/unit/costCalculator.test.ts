import { describe, expect, it } from "vitest";

import {
  calculateCost,
  estimateTokens,
} from "../../src/services/llmProxy/costCalculator.js";

describe("llmProxy cost calculator (scoring/cost accounting)", () => {
  it("estimates input/output tokens at ~4 chars/token", () => {
    const out = estimateTokens([{ role: "user", content: "hi" }], "12345678");
    expect(out.output).toBe(2); // 8 chars / 4
    expect(out.input).toBeGreaterThan(0);
    expect(out.total).toBe(out.input + out.output);
  });

  it("prices a known model correctly", () => {
    const cost = calculateCost("openai", "gpt-4o", {
      input: 1_000_000,
      output: 1_000_000,
    });
    // gpt-4o: $2.5 in + $10 out per 1M tokens.
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it("falls back to a default model price for unknown models", () => {
    const known = calculateCost("openai", "gpt-4o-mini", { input: 1_000_000, output: 0 });
    const unknown = calculateCost("openai", "totally-made-up", { input: 1_000_000, output: 0 });
    expect(unknown).toBeCloseTo(known, 6);
  });
});
