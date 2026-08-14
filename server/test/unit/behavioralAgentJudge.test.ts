/**
 * Pure helpers from the tool-using behavioral judge.
 *
 * `isAriaRoleToken` exists because `browser_snapshot` hands the agent an
 * accessibility tree of ARIA roles while `browser_fill` takes a CSS selector.
 * A production run scored a healthy app at 25% when the agent filled
 * `textbox`, Playwright looked for a `<textbox>` element, timed out, and the
 * agent read the timeout as "this app has no input".
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { describe, expect, it } from "vitest";

import { isAriaRoleToken } from "../../src/services/behavioralGrading/agentJudge.js";

describe("isAriaRoleToken", () => {
  it("recognises a bare ARIA role copied out of an accessibility snapshot", () => {
    for (const token of ["textbox", "button", "searchbox", "combobox", "checkbox"]) {
      expect(isAriaRoleToken(token)).toBe(true);
    }
  });

  it("tolerates surrounding whitespace and casing", () => {
    expect(isAriaRoleToken("  Textbox ")).toBe(true);
    expect(isAriaRoleToken("BUTTON")).toBe(true);
  });

  it("leaves real CSS selectors alone", () => {
    for (const selector of [
      ".note-input",
      "#title",
      'input[name="x"]',
      "textbox.foo",
      "form > textbox",
      "input:first-child",
      "textbox, button",
    ]) {
      expect(isAriaRoleToken(selector)).toBe(false);
    }
  });

  it("is false for empty or whitespace-only selectors", () => {
    expect(isAriaRoleToken("")).toBe(false);
    expect(isAriaRoleToken("   ")).toBe(false);
  });

  it("is false for a word that is not an ARIA role we support", () => {
    expect(isAriaRoleToken("input")).toBe(false);
    expect(isAriaRoleToken("textarea")).toBe(false);
  });
});
