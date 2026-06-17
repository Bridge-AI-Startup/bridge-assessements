import { describe, expect, it } from "vitest";

import {
  parseTranscriptJsonlToSegments,
  stitchBatchOutputs,
} from "../../src/ai/transcript/stitcher.js";

describe("transcript stitcher", () => {
  it("stitches batch outputs in chronological order and skips junk", () => {
    const batchA = [
      JSON.stringify({ ts: "2026-01-01T00:00:02Z", screen: 0, text_content: "second" }),
      "not json at all",
    ].join("\n");
    const batchB = [
      "```json",
      JSON.stringify({ ts: "2026-01-01T00:00:01Z", screen: 0, text_content: "first" }),
      "```",
      JSON.stringify({ ts: "2026-01-01T00:00:01Z", screen: 1, text_content: "first-screen1" }),
    ].join("\n");

    const jsonl = stitchBatchOutputs([batchA, batchB]);
    const segments = parseTranscriptJsonlToSegments(jsonl);

    expect(segments).toHaveLength(3);
    // Sorted by ts, then screen.
    expect(segments[0].text_content).toBe("first");
    expect(segments[1].text_content).toBe("first-screen1");
    expect(segments[2].text_content).toBe("second");
  });

  it("ignores lines missing ts or content", () => {
    const segments = parseTranscriptJsonlToSegments(
      [
        JSON.stringify({ screen: 0, text_content: "no ts" }),
        JSON.stringify({ ts: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ ts: "2026-01-01T00:00:00Z", text_content: "keep" }),
      ].join("\n")
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].text_content).toBe("keep");
  });
});
