import { describe, expect, it } from "vitest";

import {
  assertInlineProcessable,
  estimateFrameCount,
  isInlineProcessable,
} from "../e2e/lib/guards.js";

describe("E2E guardrails (counter terminal jams)", () => {
  it("estimates frame counts from duration + interval", () => {
    expect(estimateFrameCount(60, 5000)).toBe(12);
    expect(estimateFrameCount(30 * 60, 5000)).toBe(360);
  });

  it("rejects a 30-minute recording from inline analysis", () => {
    const frames = estimateFrameCount(30 * 60, 5000);
    expect(isInlineProcessable(frames, 40)).toBe(false);
    expect(() => assertInlineProcessable(frames, 40)).toThrow(/too large/i);
  });

  it("allows a short clip inline", () => {
    const frames = estimateFrameCount(6, 5000); // ~1 frame
    expect(isInlineProcessable(frames, 40)).toBe(true);
    expect(() => assertInlineProcessable(frames, 40)).not.toThrow();
  });
});
