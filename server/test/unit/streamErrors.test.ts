import { describe, expect, it } from "vitest";
import { isClientStreamAbortError } from "../../src/utils/streamErrors.js";

describe("streamErrors", () => {
  it("detects client abort stream errors", () => {
    expect(
      isClientStreamAbortError({ code: "ERR_STREAM_PREMATURE_CLOSE" })
    ).toBe(true);
    expect(
      isClientStreamAbortError({ code: "ERR_STREAM_UNABLE_TO_PIPE" })
    ).toBe(true);
    expect(isClientStreamAbortError(new Error("other"))).toBe(false);
  });
});
