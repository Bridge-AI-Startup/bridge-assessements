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

import {
  isAriaRoleToken,
  isImplicitTextInputSelector,
  planFillAttempts,
} from "../../src/services/behavioralGrading/agentJudge.js";

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

describe("isImplicitTextInputSelector", () => {
  it("treats input[type=text] as a textbox, including quoted variants", () => {
    expect(isImplicitTextInputSelector("input[type='text']")).toBe(true);
    expect(isImplicitTextInputSelector('input[type="text"]')).toBe(true);
    expect(isImplicitTextInputSelector("input[type=text]")).toBe(true);
    expect(isImplicitTextInputSelector("  input[type='text']  ")).toBe(true);
  });

  it("leaves other selectors alone", () => {
    expect(isImplicitTextInputSelector("#title")).toBe(false);
    expect(isImplicitTextInputSelector("input")).toBe(false);
    expect(isImplicitTextInputSelector("input[type='email']")).toBe(false);
  });
});

describe("planFillAttempts", () => {
  it("coerces input[type=text] to a textbox role from the start", () => {
    expect(planFillAttempts("input[type='text']")).toEqual([
      {
        strategy: "role",
        role: "textbox",
        reason:
          "`input[type=text]` does not match an untyped `<input>`; filled by role=textbox instead.",
      },
    ]);
  });

  it("retries role, placeholder, then the first input after a CSS miss", () => {
    const attempts = planFillAttempts("#title");
    expect(attempts.map((a) => a.strategy)).toEqual([
      "css",
      "role",
      "first_input",
    ]);
    expect(attempts[0]).toEqual({
      strategy: "css",
      selector: "#title",
      reason: "css",
    });
  });

  it("retries getByPlaceholder when the selector looks like a placeholder", () => {
    const attempts = planFillAttempts("Ship runtime setup…");
    expect(attempts.map((a) => a.strategy)).toEqual([
      "css",
      "role",
      "placeholder",
      "first_input",
    ]);
    expect(attempts[2]).toMatchObject({
      strategy: "placeholder",
      placeholder: "Ship runtime setup…",
    });
  });
});
