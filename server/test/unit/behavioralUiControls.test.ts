/**
 * Source-first UI locators: the submitted repo is how we find controls.
 * Playwright only executes role/placeholder locators — never getByText on
 * the rendered page, which is how the notes-board lede stole "Add".
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  fallbackUiSpecFromCatalog,
} from "../../src/services/behavioralGrading/compileCheckSpec.js";
import { runDeterministicCheck } from "../../src/services/behavioralGrading/deterministicChecks.js";
import {
  bindClickTextToCatalog,
  bindUiStepsToCatalog,
  extractUiControlsFromFiles,
  type UiControl,
} from "../../src/services/behavioralGrading/extractUiControls.js";
import type { BehavioralCheckSpec } from "../../src/services/behavioralGrading/checkSpecs.js";
import type { GradingSandboxContext } from "../../src/services/e2b/graderSandbox.js";
import type { BehavioralBrowserSession } from "../../src/services/behavioralGrading/browserSession.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTES_APP = readFileSync(
  resolve(__dirname, "../../../demos/runtime-setup-mern/client/src/App.jsx"),
  "utf8"
);

const REPO = "/home/user/repo";

function fakeSandbox(): GradingSandboxContext {
  return {
    sandboxId: "sbx-test",
    sandbox: {},
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  } as unknown as GradingSandboxContext;
}

function notesLedePage(options: {
  clickableRoles?: Array<{ role: string; name: string }>;
  fillablePlaceholders?: string[];
  bodyText?: string;
  rowText?: string;
}): { session: BehavioralBrowserSession; actions: string[] } {
  const actions: string[] = [];
  const bodyText =
    options.bodyText ??
    "Add a note, check it off, delete it. Data lives on the Express API.\nNo notes yet.";

  type LocDesc = {
    role?: string;
    name?: string;
    exact?: boolean;
    rowHasText?: string;
    hasNotName?: string;
    nth?: number;
  };

  const makeLocator = (desc: LocDesc) => {
    const loc = {
      _name: desc.name,
      fill: async (value: string) => {
        actions.push(`fill_role ${desc.role}=${value}`);
      },
      click: async () => {
        if (desc.rowHasText != null) {
          actions.push(
            `click_in_row hasText=${desc.rowHasText} role=${desc.role ?? "button"} name=${desc.name ?? ""} index=${desc.nth ?? ""} hasNotName=${desc.hasNotName ?? ""}`
          );
          return;
        }
        const name = desc.name ?? "";
        const exact = desc.exact !== false;
        const role = desc.role ?? "";
        const roles = options.clickableRoles ?? [];
        const hit = roles.some(
          (r) => r.role === role && (exact ? r.name === name : r.name.includes(name))
        );
        if (!hit) {
          throw new Error(
            `Timeout: getByRole(${role}, { name: "${name}", exact: ${exact} })`
          );
        }
        actions.push(`click_role ${role} ${name}`);
      },
      filter: (opts: { hasText?: string; hasNot?: { _name?: string } }) =>
        makeLocator({
          ...desc,
          rowHasText: opts.hasText ?? desc.rowHasText,
          hasNotName: opts.hasNot?._name ?? desc.hasNotName,
        }),
      getByRole: (role: string, opts?: { name?: string; exact?: boolean }) =>
        makeLocator({
          ...desc,
          role,
          name: opts?.name,
          exact: opts?.exact,
        }),
      nth: (n: number) => makeLocator({ ...desc, nth: n }),
      innerText: async () =>
        desc.rowHasText != null
          ? (options.rowText ?? bodyText)
          : bodyText,
    };
    return loc;
  };

  const page = {
    goto: async (url: string) => {
      actions.push(`goto ${url}`);
    },
    reload: async () => {
      actions.push("reload");
    },
    getByText: (text: string) => ({
      first: () => ({
        click: async () => {
          actions.push(`click_text ${text}`);
        },
      }),
    }),
    getByRole: (role: string, opts?: { name?: string; exact?: boolean }) =>
      makeLocator({ role, name: opts?.name, exact: opts?.exact }),
    getByPlaceholder: (placeholder: string) => ({
      fill: async (value: string) => {
        if (
          options.fillablePlaceholders &&
          !options.fillablePlaceholders.includes(placeholder)
        ) {
          throw new Error(`no placeholder ${placeholder}`);
        }
        actions.push(`fill_placeholder ${placeholder}=${value}`);
      },
    }),
    fill: async () => {
      throw new Error("css fill should not run in these tests");
    },
    locator: () => ({
      innerText: async () => bodyText,
    }),
  };
  return {
    session: { getPage: async () => page } as unknown as BehavioralBrowserSession,
    actions,
  };
}

function uiSpec(steps: unknown[]): BehavioralCheckSpec {
  return {
    id: "ui",
    text: "A visitor can add a note and see it in the list.",
    kind: "ui",
    acceptance: { steps: steps as never },
  };
}

describe("extractUiControls (notes board)", () => {
  const catalog = extractUiControlsFromFiles([
    { path: "client/src/App.jsx", content: NOTES_APP },
  ]);

  it("returns Add and Delete buttons and the placeholder, not the lede", () => {
    const buttons = catalog.filter((c) => c.kind === "button");
    const names = buttons.map((c) => c.name);
    expect(names).toContain("Add");
    expect(names).toContain("Delete");
    expect(names.some((n) => n && /add a note/i.test(n))).toBe(false);
    expect(names).not.toContain("No notes yet.");

    const box = catalog.find((c) => c.kind === "textbox");
    expect(box?.placeholder).toBe("Ship runtime setup…");

    const add = buttons.find((c) => c.name === "Add");
    expect(add?.source.path).toBe("client/src/App.jsx");
    expect(add?.source.line).toBeGreaterThan(0);
    expect(add?.source.snippet).toMatch(/button/i);

    const unnamed = buttons.find((c) => !c.name);
    expect(unnamed?.handler).toBe("toggle");
    expect(unnamed?.className).toBe("check");
    expect(unnamed?.source.snippet).toMatch(/toggle/);
  });

  it("binds leftover click_text Add to click_role button Add exact", () => {
    const bound = bindClickTextToCatalog("Add", catalog);
    expect(bound).toEqual({
      action: "click_role",
      role: "button",
      name: "Add",
      exact: true,
    });
    expect(bindClickTextToCatalog("Add a note", catalog)).toBeNull();
    expect(bindClickTextToCatalog("No notes yet.", catalog)).toBeNull();
  });

  it("drops a walkthrough that clicks lede prose", () => {
    const steps = bindUiStepsToCatalog(
      [
        { action: "goto", path: "/" },
        { action: "click_text", text: "Add a note" },
        { action: "expect_text", text: "{{nonce}}" },
      ],
      catalog
    );
    expect(steps).toBeNull();
  });
});

describe("fallbackUiSpecFromCatalog", () => {
  const catalog: UiControl[] = extractUiControlsFromFiles([
    { path: "client/src/App.jsx", content: NOTES_APP },
  ]);

  it("builds an add walkthrough as click_role button Add", () => {
    const spec = fallbackUiSpecFromCatalog({
      checkText: "A visitor can add a note and see it in the list without refreshing.",
      checkId: "check-add",
      catalog,
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

  it("builds a delete walkthrough that removes the nonce row, not a page-wide Delete", () => {
    const spec = fallbackUiSpecFromCatalog({
      checkText: "Deleting a note removes it from the list.",
      checkId: "check-del",
      catalog,
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
    expect(spec.acceptance.steps[5]).toEqual({
      action: "expect_text",
      text: "{{nonce}}",
      absent: true,
    });
  });

  it("builds a check-off walkthrough with click_in_row + reload", () => {
    const spec = fallbackUiSpecFromCatalog({
      checkText:
        "Checking a note off marks it done and that state survives a page reload.",
      checkId: "check-done",
      catalog,
    });
    expect(spec?.kind).toBe("ui");
    if (spec?.kind !== "ui") return;
    expect(spec.acceptance.steps.map((s) => s.action)).toEqual([
      "goto",
      "fill_placeholder",
      "click_role",
      "expect_text",
      "click_in_row",
      "reload",
      "expect_text",
      "expect_in_row",
    ]);
    expect(spec.acceptance.steps[4]).toMatchObject({
      action: "click_in_row",
      hasText: "{{nonce}}",
      role: "button",
      index: 0,
      hasNotName: "Delete",
    });
    expect(spec.acceptance.steps[5]).toEqual({ action: "reload" });
    expect(spec.acceptance.steps[7]).toMatchObject({
      action: "expect_in_row",
      hasText: "{{nonce}}",
      text: "✓",
    });
  });
});

describe("runUiSpec source-first locators", () => {
  const catalog: UiControl[] = extractUiControlsFromFiles([
    { path: "client/src/App.jsx", content: NOTES_APP },
  ]);

  it("clicks getByRole button Add exact, not getByText (which would hit the lede)", async () => {
    const browser = notesLedePage({
      clickableRoles: [{ role: "button", name: "Add" }],
      fillablePlaceholders: ["Ship runtime setup…"],
      bodyText:
        "Add a note, check it off, delete it.\nnonce-note\nDelete",
    });
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([
        { action: "goto", path: "/" },
        {
          action: "fill_placeholder",
          placeholder: "Ship runtime setup…",
          value: "nonce-note",
        },
        { action: "click_role", role: "button", name: "Add", exact: true },
        { action: "expect_text", text: "nonce-note" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog,
    });
    expect(result.verdict).toBe("pass");
    expect(browser.actions).toContain("click_role button Add");
    expect(browser.actions.some((a) => a.startsWith("click_text"))).toBe(false);
  });

  it("resolves leftover click_text through the catalog before touching the page", async () => {
    const browser = notesLedePage({
      clickableRoles: [{ role: "button", name: "Add" }],
      bodyText: "Add a note, check it off, delete it.\nBuy milk",
    });
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([
        { action: "click_text", text: "Add" },
        { action: "expect_text", text: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog,
    });
    expect(result.verdict).toBe("pass");
    expect(browser.actions).toEqual(["click_role button Add"]);
  });

  it("is inconclusive when leftover click_text has no catalog match — never getByText", async () => {
    const browser = notesLedePage({
      clickableRoles: [{ role: "button", name: "Add" }],
    });
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([{ action: "click_text", text: "Add a note" }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toMatch(/source catalog|could not be observed/i);
    expect(browser.actions).toEqual([]);
  });

  it("deepens source once on a miss, then stays inconclusive if still unbound", async () => {
    const browser = notesLedePage({ clickableRoles: [] });
    let deepenCalls = 0;
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([{ action: "click_text", text: "Add" }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog: [],
      deepenCatalog: async () => {
        deepenCalls += 1;
        return [];
      },
    });
    expect(deepenCalls).toBe(1);
    expect(result.verdict).toBe("inconclusive");
    expect(browser.actions.some((a) => a.startsWith("click_text"))).toBe(false);
  });

  it("uses a control found on the deepen pass", async () => {
    const browser = notesLedePage({
      clickableRoles: [{ role: "button", name: "Add" }],
      bodyText: "Buy milk",
    });
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([
        { action: "click_text", text: "Add" },
        { action: "expect_text", text: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog: [],
      deepenCatalog: async () => catalog,
    });
    expect(result.verdict).toBe("pass");
    expect(browser.actions).toEqual(["click_role button Add"]);
  });

  it("clicks a nameless control via listitem filter, then reloads — never getByText", async () => {
    const browser = notesLedePage({
      clickableRoles: [{ role: "button", name: "Add" }],
      fillablePlaceholders: ["Ship runtime setup…"],
      bodyText: "Add a note, check it off.\nnonce-note ✓",
      rowText: "✓ nonce-note Delete",
    });
    const result = await runDeterministicCheck({
      ctx: fakeSandbox(),
      spec: uiSpec([
        { action: "goto", path: "/" },
        {
          action: "fill_placeholder",
          placeholder: "Ship runtime setup…",
          value: "nonce-note",
        },
        { action: "click_role", role: "button", name: "Add", exact: true },
        { action: "expect_text", text: "nonce-note" },
        {
          action: "click_in_row",
          hasText: "nonce-note",
          role: "button",
          index: 0,
          hasNotName: "Delete",
        },
        { action: "reload" },
        { action: "expect_text", text: "nonce-note" },
        {
          action: "expect_in_row",
          hasText: "nonce-note",
          text: "✓",
        },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
      catalog,
    });
    expect(result.verdict).toBe("pass");
    expect(browser.actions).toContain("click_role button Add");
    expect(browser.actions.some((a) => a.startsWith("click_in_row"))).toBe(true);
    expect(browser.actions).toContain("reload");
    expect(browser.actions.some((a) => a.startsWith("click_text"))).toBe(false);
  });
});
