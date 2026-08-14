/**
 * Capability graph: bind check sentences to product commands extracted from
 * source, then instantiate purpose templates. Notes-board fixture is the
 * regression for test4 (Add / check-off / Delete / GET /health).
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileCheckSpec } from "../../src/services/behavioralGrading/compileCheckSpec.js";
import { extractCapabilitiesFromFiles } from "../../src/services/behavioralGrading/extractCapabilities.js";
import {
  inferPurpose,
  validateCapabilityLink,
} from "../../src/services/behavioralGrading/linkCheckCapabilities.js";
import { synthesizeAcceptance } from "../../src/services/behavioralGrading/synthesizeAcceptance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTES_APP = readFileSync(
  resolve(__dirname, "../../../demos/runtime-setup-mern/client/src/App.jsx"),
  "utf8"
);
const NOTES_SERVER = readFileSync(
  resolve(__dirname, "../../../demos/runtime-setup-mern/server/index.js"),
  "utf8"
);

const CHECKS = {
  add: "A visitor can add a note and see it in the list without refreshing.",
  done: "Checking a note off marks it done and that state survives a page reload.",
  del: "Deleting a note removes it from the list.",
  health: "GET /health returns a successful JSON payload.",
};

function notesCapabilities() {
  return extractCapabilitiesFromFiles([
    { path: "client/src/App.jsx", content: NOTES_APP },
    { path: "server/index.js", content: NOTES_SERVER },
  ]);
}

describe("extractCapabilities (notes board)", () => {
  const caps = notesCapabilities();

  it("keeps the nameless check-off button and named Add/Delete", () => {
    const clicks = caps.filter((c) => c.kind === "ui.click");
    expect(clicks.some((c) => c.name === "Add")).toBe(true);
    expect(clicks.some((c) => c.name === "Delete")).toBe(true);
    const toggle = clicks.find((c) => c.handler === "toggle");
    expect(toggle).toBeDefined();
    expect(toggle?.name).toBeUndefined();
    expect(toggle?.className).toBe("check");
    expect(toggle?.source.path).toBe("client/src/App.jsx");
    expect(toggle?.source.line).toBeGreaterThan(0);
  });

  it("extracts fetch and Express routes from source, including GET /health", () => {
    const http = caps.filter((c) => c.kind === "http");
    expect(
      http.some((c) => c.method === "GET" && c.path === "/health")
    ).toBe(true);
    expect(
      http.some((c) => c.method === "POST" && c.path === "/api/notes")
    ).toBe(true);
    expect(
      http.some((c) => c.method === "PATCH" && c.path === "/api/notes/:id")
    ).toBe(true);
    expect(
      http.some((c) => c.method === "DELETE" && c.path === "/api/notes/:id")
    ).toBe(true);
    const health = http.find((c) => c.path === "/health");
    expect(health?.signals).toContain("ok");
  });
});

describe("purpose linking", () => {
  it("maps the four notes-board sentences to purposes", () => {
    expect(inferPurpose(CHECKS.add)).toBe("create");
    expect(inferPurpose(CHECKS.done)).toBe("toggle_done");
    expect(inferPurpose(CHECKS.del)).toBe("delete");
    expect(inferPurpose(CHECKS.health)).toBe("health");
  });

  it("drops invented capability IDs", () => {
    const caps = notesCapabilities();
    expect(
      validateCapabilityLink(
        { purpose: "toggle_done", capabilityIds: ["invented-click", "not-real"] },
        caps,
        { id: "x", text: CHECKS.done }
      )
    ).toBeNull();
    const real = caps.find((c) => c.handler === "toggle");
    expect(real).toBeDefined();
    const kept = validateCapabilityLink(
      {
        purpose: "toggle_done",
        capabilityIds: ["invented-click", real!.id],
      },
      caps,
      { id: "x", text: CHECKS.done }
    );
    expect(kept?.capabilityIds).toEqual([real!.id]);
  });
});

describe("synthesizeAcceptance (test4 notes board)", () => {
  const caps = notesCapabilities();

  it("compiles Add as named click_role, not page-text search", () => {
    const spec = synthesizeAcceptance({
      checkText: CHECKS.add,
      checkId: "add",
      capabilities: caps,
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

  it("compiles check-off to click_in_row + reload + done signal", () => {
    const spec = synthesizeAcceptance({
      checkText: CHECKS.done,
      checkId: "done",
      capabilities: caps,
    });
    expect(spec?.kind).toBe("ui");
    if (spec?.kind !== "ui") return;
    const actions = spec.acceptance.steps.map((s) => s.action);
    expect(actions).toEqual([
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
      index: 0,
      hasNotName: "Delete",
    });
    expect(spec.acceptance.steps[4]).toHaveProperty("source");
    expect(String((spec.acceptance.steps[4] as { source?: string }).source)).toMatch(
      /App\.jsx:\d+/
    );
  });

  it("compiles Delete as nonce-row click, then nonce absent", () => {
    const spec = synthesizeAcceptance({
      checkText: CHECKS.del,
      checkId: "del",
      capabilities: caps,
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
    expect(spec.acceptance.steps[3]).toEqual({
      action: "expect_text",
      text: "{{nonce}}",
    });
    expect(spec.acceptance.steps[4]).toMatchObject({
      action: "click_in_row",
      name: "Delete",
      hasText: "{{nonce}}",
    });
    expect(spec.acceptance.steps[5]).toEqual({
      action: "expect_text",
      text: "{{nonce}}",
      absent: true,
    });
  });

  it("compiles GET /health from the Express route, not the job-description text", () => {
    const spec = synthesizeAcceptance({
      checkText: CHECKS.health,
      checkId: "health",
      capabilities: caps,
    });
    expect(spec?.kind).toBe("http");
    if (spec?.kind !== "http") return;
    expect(spec.acceptance.request).toEqual({
      method: "GET",
      path: "/health",
    });
    expect(spec.acceptance.expect.status).toEqual([200]);
    expect(spec.acceptance.expect.bodyContains).toContain('"ok":true');
  });

  it("returns null when the inventory cannot support the purpose", () => {
    expect(
      synthesizeAcceptance({
        checkText: CHECKS.done,
        capabilities: caps.filter((c) => c.handler !== "toggle" && c.className !== "check"),
      })
    ).toBeNull();
  });
});

describe("compileCheckSpec uses the capability graph without an LLM walkthrough", () => {
  const caps = notesCapabilities();

  it("decides all four test4 checks", async () => {
    const results = await Promise.all(
      Object.entries(CHECKS).map(async ([id, text]) => {
        const compiled = await compileCheckSpec({
          checkText: text,
          checkId: id,
          assessmentDescription: "A notes board. Implementation is up to the candidate.",
          capabilities: caps,
        });
        return { id, compiled };
      })
    );
    for (const { id, compiled } of results) {
      expect(compiled.ok, id).toBe(true);
      if (!compiled.ok) continue;
      if (id === "health") expect(compiled.spec.kind).toBe("http");
      else expect(compiled.spec.kind).toBe("ui");
    }
  });
});
