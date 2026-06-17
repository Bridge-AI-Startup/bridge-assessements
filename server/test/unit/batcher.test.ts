import { describe, expect, it } from "vitest";

import { createBatches } from "../../src/ai/transcript/batcher.js";
import type { PreparedFrame } from "../../src/services/capture/framePrep.js";

function frame(i: number, w = 800, h = 600): PreparedFrame {
  return {
    storageKey: `k${i}`,
    buffer: Buffer.from([i]),
    screenIndex: 0,
    capturedAt: new Date(2026, 0, 1, 0, 0, i),
    width: w,
    height: h,
  };
}

describe("transcript batcher", () => {
  it("returns no batches for no frames", () => {
    expect(createBatches([])).toEqual([]);
  });

  it("groups frames by the default batch size of 2", () => {
    const batches = createBatches([frame(0), frame(1), frame(2)]);
    expect(batches).toHaveLength(2);
    expect(batches[0].frames).toHaveLength(2);
    expect(batches[1].frames).toHaveLength(1);
    expect(batches.map((b) => b.batchIndex)).toEqual([0, 1]);
  });

  it("re-splits very high-res frame groups into smaller batches", () => {
    const big = Array.from({ length: 6 }, (_, i) => frame(i, 4000, 2200));
    const batches = createBatches(big, 6);
    // 6 frames at >4K should not all land in one batch.
    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map((b) => b.frames.length))).toBeLessThanOrEqual(3);
  });
});
