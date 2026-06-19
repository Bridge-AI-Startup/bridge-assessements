import { describe, expect, it } from "vitest";
import {
  buildContentRangeHeader,
  parseRangeHeader,
  rangeContentLength,
} from "../../src/utils/httpRange.js";

describe("httpRange", () => {
  it("parses a closed byte range", () => {
    expect(parseRangeHeader("bytes=0-1023", 5000)).toEqual({
      start: 0,
      end: 1023,
    });
  });

  it("parses an open-ended byte range", () => {
    expect(parseRangeHeader("bytes=1000-", 5000)).toEqual({
      start: 1000,
      end: 4999,
    });
  });

  it("parses a suffix byte range", () => {
    expect(parseRangeHeader("bytes=-500", 5000)).toEqual({
      start: 4500,
      end: 4999,
    });
  });

  it("returns null for invalid or out-of-bounds ranges", () => {
    expect(parseRangeHeader(undefined, 100)).toBeNull();
    expect(parseRangeHeader("bytes=abc-def", 100)).toBeNull();
    expect(parseRangeHeader("bytes=200-100", 500)).toBeNull();
    expect(parseRangeHeader("bytes=500-499", 500)).toBeNull();
  });

  it("builds Content-Range header and length", () => {
    const range = { start: 10, end: 19 };
    expect(buildContentRangeHeader(10, 19, 100)).toBe("bytes 10-19/100");
    expect(rangeContentLength(range)).toBe(10);
  });
});
