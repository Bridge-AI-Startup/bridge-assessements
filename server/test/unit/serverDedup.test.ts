import { describe, expect, it } from "vitest";

import {
  computeFrameHash,
  deduplicateFrames,
} from "../../src/services/capture/serverDedup.js";

describe("server-side frame dedup", () => {
  it("computes a stable sha-256 for identical buffers", () => {
    const a = computeFrameHash(Buffer.from("hello"));
    const b = computeFrameHash(Buffer.from("hello"));
    const c = computeFrameHash(Buffer.from("world"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("marks exact duplicates per screen", () => {
    const dup = Buffer.from("same");
    const frames = [
      { buffer: dup, screenIndex: 0 },
      { buffer: dup, screenIndex: 0 }, // duplicate of #1
      { buffer: dup, screenIndex: 1 }, // different screen -> not a duplicate
      { buffer: Buffer.from("other"), screenIndex: 0 },
    ];
    const result = deduplicateFrames(frames);
    expect(result.map((f) => f.isDuplicate)).toEqual([false, true, false, false]);
  });
});
