/**
 * Loose LLM suggestions must convert into Zod specs or be dropped.
 * Inventing an HTTP path the assessment never named is how a working UI
 * fails an interface it never promised — that suggestion is discarded.
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { describe, expect, it } from "vitest";

import type { SuggestedAcceptance } from "../../src/services/schemas/assessmentGeneration.js";
import {
  checkNamesHttpContract,
  fallbackUiSpecFromCatalog,
} from "../../src/services/behavioralGrading/compileCheckSpec.js";
import {
  bindClickTextToCatalog,
  extractUiControlsFromFiles,
} from "../../src/services/behavioralGrading/extractUiControls.js";
import {
  httpPathIsGrounded,
  suggestionToSpec,
  suggestionsToSpecs,
} from "../../src/services/behavioralGrading/specSuggestions.js";

const ADD_NOTE = "Someone can add a note.";

describe("httpPathIsGrounded", () => {
  it("always allows /", () => {
    expect(httpPathIsGrounded("/", "")).toBe(true);
  });

  it("requires the path to already appear in the description or snapshot", () => {
    expect(httpPathIsGrounded("/notes", "expose GET /notes")).toBe(true);
    expect(httpPathIsGrounded("/api/notes", "a notes app")).toBe(false);
  });
});

describe("suggestionsToSpecs", () => {
  it("converts a UI walkthrough that uses {{nonce}}", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "ui",
      uiSteps: [
        { action: "goto", path: "/" },
        {
          action: "fill_placeholder",
          placeholder: "Ship runtime setup…",
          value: "{{nonce}}",
        },
        { action: "click_text", text: "Add" },
        { action: "expect_text", text: "{{nonce}}" },
      ],
    };
    const specs = suggestionsToSpecs([ADD_NOTE], [suggestion]);
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe("ui");
    if (specs[0].kind !== "ui") return;
    expect(specs[0].acceptance.steps).toEqual([
      { action: "goto", path: "/" },
      {
        action: "fill_placeholder",
        placeholder: "Ship runtime setup…",
        value: "{{nonce}}",
      },
      { action: "click_text", text: "Add" },
      { action: "expect_text", text: "{{nonce}}" },
    ]);
  });

  it("drops an HTTP suggestion whose path is not in the description", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "http",
      requests: [
        {
          method: "POST",
          path: "/api/notes",
          jsonBody: '{"title":"{{nonce}}"}',
          expectStatus: [201],
        },
      ],
    };
    expect(
      suggestionsToSpecs([ADD_NOTE], [suggestion], "Build a notes board.")
    ).toEqual([]);
  });

  it("keeps an HTTP suggestion when the description already names the path", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "http",
      requests: [
        {
          method: "POST",
          path: "/notes",
          jsonBody: '{"title":"{{nonce}}"}',
          expectStatus: [201],
          expectBodyContains: ["{{nonce}}"],
        },
      ],
    };
    const specs = suggestionsToSpecs(
      [ADD_NOTE],
      [suggestion],
      "Expose POST /notes returning 201."
    );
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe("http");
  });

  it("does not persist kind=agent suggestions — those stay a leftover to compile later", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "agent",
    };
    expect(suggestionsToSpecs([ADD_NOTE], [suggestion])).toEqual([]);
    expect(suggestionToSpec(ADD_NOTE, suggestion)?.kind).toBe("agent");
  });

  it("drops an incomplete UI walkthrough", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "ui",
      uiSteps: [{ action: "fill_placeholder", value: "x" }],
    };
    expect(suggestionsToSpecs([ADD_NOTE], [suggestion])).toEqual([]);
  });
});

describe("checkNamesHttpContract", () => {
  it("is true only when the check sentence itself names a method or path", () => {
    expect(checkNamesHttpContract("GET /health returns a successful JSON payload.")).toBe(
      true
    );
    expect(checkNamesHttpContract("A visitor can add a note and see it in the list.")).toBe(
      false
    );
    expect(checkNamesHttpContract("Deleting a note removes it from the list.")).toBe(false);
  });
});

const NOTES_CATALOG = extractUiControlsFromFiles([
  {
    path: "client/src/App.jsx",
    content: `<form>
  <input placeholder="Ship runtime setup…" />
  <button type="submit">Add</button>
</form>
<button type="button">Delete</button>
<p className="lede">Add a note, check it off, delete it.</p>
<li className="empty">No notes yet.</li>`,
  },
]);

describe("catalog-bound UI suggestions", () => {
  it("rewrites leftover click_text onto catalog click_role", () => {
    expect(bindClickTextToCatalog("Add", NOTES_CATALOG)).toEqual({
      action: "click_role",
      role: "button",
      name: "Add",
      exact: true,
    });
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "ui",
      uiSteps: [
        { action: "goto", path: "/" },
        {
          action: "fill_placeholder",
          placeholder: "Ship runtime setup…",
          value: "{{nonce}}",
        },
        { action: "click_text", text: "Add" },
        { action: "expect_text", text: "{{nonce}}" },
      ],
    };
    const spec = suggestionToSpec(ADD_NOTE, suggestion, undefined, NOTES_CATALOG);
    expect(spec?.kind).toBe("ui");
    if (spec?.kind !== "ui") return;
    expect(spec.acceptance.steps[2]).toEqual({
      action: "click_role",
      role: "button",
      name: "Add",
      exact: true,
    });
  });

  it("drops a click on lede prose that is not a catalog control", () => {
    const suggestion: SuggestedAcceptance = {
      text: ADD_NOTE,
      kind: "ui",
      uiSteps: [
        { action: "goto", path: "/" },
        { action: "click_text", text: "Add a note" },
        { action: "expect_text", text: "{{nonce}}" },
      ],
    };
    expect(suggestionToSpec(ADD_NOTE, suggestion, undefined, NOTES_CATALOG)).toBeNull();
  });
});

describe("fallbackUiSpecFromCatalog", () => {
  it("builds an add walkthrough from catalog Add, not snapshot prose", () => {
    const spec = fallbackUiSpecFromCatalog({
      checkText: "A visitor can add a note and see it in the list without refreshing.",
      checkId: "check-add",
      catalog: NOTES_CATALOG,
    });
    expect(spec?.kind).toBe("ui");
    if (spec?.kind !== "ui") return;
    expect(spec.acceptance.steps).toEqual([
      { action: "goto", path: "/" },
      {
        action: "fill_placeholder",
        placeholder: "Ship runtime setup…",
        value: "{{nonce}}",
      },
      { action: "click_role", role: "button", name: "Add", exact: true },
      { action: "expect_text", text: "{{nonce}}" },
    ]);
  });

  it("builds a delete walkthrough that adds first, then removes the nonce row", () => {
    const spec = fallbackUiSpecFromCatalog({
      checkText: "Deleting a note removes it from the list.",
      checkId: "check-del",
      catalog: NOTES_CATALOG,
    });
    expect(spec?.kind).toBe("ui");
    if (spec?.kind !== "ui") return;
    expect(spec.acceptance.steps.map((s) => s.action)).toEqual([
      "goto",
      "fill_placeholder",
      "click_role",
      "expect_text",
      "click_in_row",
      "expect_text",
    ]);
    expect(spec.acceptance.steps[4]).toMatchObject({
      action: "click_in_row",
      hasText: "{{nonce}}",
      role: "button",
      name: "Delete",
    });
  });

  it("does not fake a pass for an unnamed checkbox by only adding a note", () => {
    expect(
      fallbackUiSpecFromCatalog({
        checkText: "Checking a note off marks it done and that state survives a page reload.",
        catalog: NOTES_CATALOG,
      })
    ).toBeNull();
  });
});
