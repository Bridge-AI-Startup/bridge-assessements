import { describe, expect, it } from "vitest";
import {
  applyHtmlPatches,
  parseHtmlPatches,
  PatchApplyError,
  stripHtmlPatchBlocks,
} from "../../src/services/shorts/htmlPatches.js";

const PATCH = `*** SEARCH
hello
*** REPLACE
world
*** END`;

describe("parseHtmlPatches", () => {
  it("parses one or more SEARCH/REPLACE blocks", () => {
    const patches = parseHtmlPatches(
      `note\n${PATCH}\n\n*** SEARCH\nfoo\n*** REPLACE\nbar\n*** END\n`,
    );
    expect(patches).toEqual([
      { search: "hello", replace: "world" },
      { search: "foo", replace: "bar" },
    ]);
  });

  it("returns no patches when the markers are missing", () => {
    expect(parseHtmlPatches("<html>no patches here</html>")).toEqual([]);
  });
});

describe("applyHtmlPatches", () => {
  it("replaces a unique substring", () => {
    expect(applyHtmlPatches("say hello there", [{ search: "hello", replace: "world" }])).toBe(
      "say world there",
    );
  });

  it("rejects a search that is missing or not unique", () => {
    expect(() =>
      applyHtmlPatches("hello hello", [{ search: "hello", replace: "hi" }]),
    ).toThrow(PatchApplyError);
    expect(() =>
      applyHtmlPatches("nope", [{ search: "hello", replace: "hi" }]),
    ).toThrow(PatchApplyError);
  });

  it("applies patches in order so later ones see earlier replacements", () => {
    expect(
      applyHtmlPatches("ab", [
        { search: "a", replace: "aa" },
        { search: "aa", replace: "z" },
      ]),
    ).toBe("zb");
  });
});

describe("stripHtmlPatchBlocks", () => {
  it("removes patch blocks so leftover prose can be the chat message", () => {
    expect(stripHtmlPatchBlocks(`Done.\n${PATCH}\n`)).toBe("Done.");
  });
});
