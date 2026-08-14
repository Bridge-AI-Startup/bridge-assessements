/**
 * Tests for the deterministic half of behavioral grading.
 *
 * The promise this code makes is that a verdict is either reproducible from a
 * recorded request or explicitly undecided. These tests hold it to that, so the
 * distinctions that matter to a rejected candidate are pinned down:
 *
 *  - an assertion the app disagreed with is a **fail**
 *  - something we could not look at is **blocked** or **inconclusive**, never a fail
 *  - a `pass` on stored data is impossible for an app that only echoes fixtures
 *
 * Nothing here talks to E2B, Playwright, or an LLM: the sandbox is a fake that
 * answers curl, and the fixture variants of the eval harness are simulated in
 * memory, which is what lets the acceptance matrix be asserted in milliseconds.
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyNonce,
  behavioralCheckSpecSchema,
  isDeterministicSpec,
  legacyCheckId,
  parseBehavioralCheckSpecs,
  resolveBehavioralCheckSpecs,
  specUsesNonce,
  type BehavioralCheckSpec,
} from "../../src/services/behavioralGrading/checkSpecs.js";
import {
  jsonContainsSubset,
  responseBodyContains,
  runDeterministicCheck,
  type DeterministicRunResult,
} from "../../src/services/behavioralGrading/deterministicChecks.js";
import { computeBehavioralScore } from "../../src/services/behavioralGrading/scoring.js";
import type { GradingSandboxContext } from "../../src/services/e2b/graderSandbox.js";
import type { BehavioralBrowserSession } from "../../src/services/behavioralGrading/browserSession.js";
import {
  BEHAVIORAL_CHECKS,
  BEHAVIORAL_CHECK_SPECS,
  VARIANT_SPECS,
  type FixtureVariant,
} from "../grading-eval/expectations.js";

const ORIGIN = "http://127.0.0.1:4310";
const REPO = "/home/user/repo";

// ---------------------------------------------------------------------------
// Fake sandbox
// ---------------------------------------------------------------------------

type HttpRequestRecord = { method: string; path: string; body: string };
type HttpReply = { status: number; body: string } | null;

type SimulatedApp = {
  http: (req: HttpRequestRecord) => HttpReply;
  restart?: () => void;
};

type CliReply = { exitCode: number; stdout?: string; stderr?: string };

/** Undo `bashLc`'s single-quote escaping for one captured argument. */
function unescapeShell(value: string): string {
  return value.split(`'\\''`).join("'");
}

/**
 * Recover the request the runner intended from the curl script it built. Reading
 * it back out of the command is deliberate: it proves the runner really shells
 * out with the method, path, and body the spec asked for, rather than trusting a
 * mock that was handed the parsed request.
 */
function parseCurlScript(script: string): HttpRequestRecord {
  const method = script.match(/-X ([A-Z]+)/)?.[1] ?? "GET";
  const url = script.match(/https?:\/\/[^\s'\\]+/)?.[0] ?? "";
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const body = script.match(/-d '\\''([\s\S]*?)'\\''/)?.[1] ?? "";
  return { method, path, body: unescapeShell(body) };
}

type FakeSandbox = {
  ctx: GradingSandboxContext;
  requests: HttpRequestRecord[];
  commands: string[];
};

function fakeSandbox(options: {
  app?: SimulatedApp;
  cli?: (command: string) => CliReply;
  /** Blow up instead of answering, as an unreachable sandbox would. */
  throwOnRun?: string;
} = {}): FakeSandbox {
  const requests: HttpRequestRecord[] = [];
  const commands: string[] = [];

  const run = async (cmd: string) => {
    if (options.throwOnRun) throw new Error(options.throwOnRun);

    if (cmd.includes("__BG_STATUS__")) {
      const request = parseCurlScript(cmd);
      requests.push(request);
      const reply = options.app?.http(request) ?? null;
      if (!reply) {
        return {
          exitCode: 7,
          stdout: "",
          stderr: "curl: (7) Failed to connect to 127.0.0.1 port 4310",
        };
      }
      return {
        exitCode: 0,
        stdout: `__BG_STATUS__${reply.status}\n${reply.body}`,
        stderr: "",
      };
    }

    const inner = cmd.replace(/^bash -lc '/, "").replace(/'$/, "");
    const command = unescapeShell(inner);
    commands.push(command);
    const reply = options.cli?.(command) ?? { exitCode: 0, stdout: "" };
    return {
      exitCode: reply.exitCode,
      stdout: reply.stdout ?? "",
      stderr: reply.stderr ?? "",
    };
  };

  return {
    ctx: { sandboxId: "sbx-test", sandbox: {}, run } as unknown as GradingSandboxContext,
    requests,
    commands,
  };
}

// ---------------------------------------------------------------------------
// Fake browser
// ---------------------------------------------------------------------------

type FakePageOptions = {
  bodyText?: string;
  gotoError?: string;
  clickable?: string[];
  clickableRoles?: Array<{ role: string; name: string }>;
  fillable?: string[];
  fillableRoles?: string[];
  fillablePlaceholders?: string[];
};

function fakeBrowserSession(options: FakePageOptions): {
  session: BehavioralBrowserSession;
  actions: string[];
} {
  const actions: string[] = [];
  const page = {
    goto: async (url: string) => {
      if (options.gotoError) throw new Error(options.gotoError);
      actions.push(`goto ${url}`);
    },
    getByText: (text: string) => ({
      first: () => ({
        click: async () => {
          // Substring search — the notes-board lede would win here. The runner
          // must not call this for control discovery.
          actions.push(`click_text ${text}`);
        },
      }),
    }),
    getByRole: (role: string, opts?: { name?: string; exact?: boolean }) => ({
      fill: async (value: string) => {
        if (options.fillableRoles && !options.fillableRoles.includes(role)) {
          throw new Error(`locator.fill: no ${role}`);
        }
        actions.push(`fill_role ${role}=${value}`);
      },
      click: async () => {
        const name = opts?.name ?? "";
        const exact = opts?.exact !== false;
        const roles = options.clickableRoles;
        if (roles) {
          const hit = roles.some(
            (r) =>
              r.role === role &&
              (exact ? r.name === name : r.name.toLowerCase().includes(name.toLowerCase()))
          );
          if (!hit) {
            throw new Error(
              `locator.click: Timeout — getByRole(${role}, { name: ${JSON.stringify(name)}, exact: ${exact} })`
            );
          }
        } else if (options.clickable && name) {
          if (exact ? !options.clickable.includes(name) : !options.clickable.some((c) => c.includes(name))) {
            throw new Error(`locator.click: no ${role} named "${name}"`);
          }
        }
        actions.push(`click_role ${role} ${name}`);
      },
    }),
    getByPlaceholder: (placeholder: string) => ({
      fill: async (value: string) => {
        if (
          options.fillablePlaceholders &&
          !options.fillablePlaceholders.includes(placeholder)
        ) {
          throw new Error(`locator.fill: no placeholder "${placeholder}"`);
        }
        actions.push(`fill_placeholder ${placeholder}=${value}`);
      },
    }),
    fill: async (selector: string, value: string) => {
      if (options.fillable && !options.fillable.includes(selector)) {
        throw new Error(`locator.fill: no element matching ${selector}`);
      }
      actions.push(`fill ${selector}=${value}`);
    },
    locator: (sel?: string) => ({
      innerText: async () => options.bodyText ?? "",
      first: () => ({
        fill: async (value: string) => {
          actions.push(`fill first ${sel ?? ""}=${value}`);
        },
      }),
    }),
  };
  return {
    session: { getPage: async () => page } as unknown as BehavioralBrowserSession,
    actions,
  };
}

const brokenBrowserSession = {
  getPage: async () => {
    throw new Error("[browser unavailable] chromium is not installed");
  },
} as unknown as BehavioralBrowserSession;

// ---------------------------------------------------------------------------
// Simulated fixture variants (same behaviors as server/test/grading-fixtures)
// ---------------------------------------------------------------------------

type Note = { id: string; title: string };

function notesApp(variant: Exclude<FixtureVariant, "wont-boot">): SimulatedApp {
  let stored: Note[] = [];
  let durable: Note[] = [];
  const hardcoded: Note[] = [
    { id: "note-1", title: "Buy milk" },
    { id: "note-2", title: "Ship the release" },
  ];

  const json = (status: number, value: unknown): HttpReply => ({
    status,
    body: JSON.stringify(value),
  });

  return {
    http: ({ method, path, body }) => {
      if (method === "GET" && path === "/health") return json(200, { ok: true });

      if (method === "GET" && path === "/notes") {
        return json(200, { notes: variant === "fake-pass" ? hardcoded : stored });
      }

      if (method === "POST" && path === "/notes") {
        let parsed: { title?: unknown } = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          return json(400, { error: "Request body must be valid JSON." });
        }
        const title = typeof parsed.title === "string" ? parsed.title.trim() : "";

        if (variant === "fake-pass") {
          // Answers plausibly; stores nothing.
          return json(201, { note: { id: "note-3", title } });
        }
        if (!title && variant !== "no-validation") {
          return json(400, { error: "Title is required." });
        }
        const note = { id: `n${stored.length + 1}`, title };
        stored = [...stored, note];
        if (variant !== "no-persistence") durable = stored;
        return json(201, { note });
      }

      return json(404, { error: "Not found" });
    },
    restart: () => {
      stored = variant === "no-persistence" ? [] : [...durable];
    },
  };
}

/**
 * The restart path polls the origin on a real timer. Drive the clock so the test
 * costs milliseconds instead of seconds; the code under test is unchanged.
 */
async function withFastTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    let settled = false;
    const promise = fn().finally(() => {
      settled = true;
    });
    for (let i = 0; i < 500 && !settled; i += 1) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// Spec fixtures
// ---------------------------------------------------------------------------

const httpSpec = (
  overrides: Partial<Extract<BehavioralCheckSpec, { kind: "http" }>> = {}
): BehavioralCheckSpec => ({
  id: "c1",
  text: "Asking for the list of notes returns a response.",
  kind: "http",
  acceptance: {
    request: { method: "GET", path: "/notes" },
    expect: { status: [200] },
  },
  ...overrides,
});

function evidenceText(result: DeterministicRunResult): string {
  return JSON.stringify(result.evidence) + result.citations.join(" ") + result.rationale;
}

// ---------------------------------------------------------------------------

describe("behavioral check spec parsing", () => {
  it("accepts a spec for every kind the runner can execute", () => {
    const specs: unknown[] = [
      { id: "a", text: "t", kind: "agent" },
      httpSpec(),
      {
        id: "c",
        text: "t",
        kind: "http_sequence",
        acceptance: {
          steps: [
            { request: { method: "POST", path: "/notes" }, expect: { status: [201] } },
            { request: { path: "/notes" }, expect: { bodyContains: ["x"] } },
          ],
        },
      },
      {
        id: "d",
        text: "t",
        kind: "restart_persistence",
        acceptance: {
          write: { request: { method: "POST", path: "/notes" }, expect: { status: [201] } },
          read: { request: { path: "/notes" }, expect: { bodyContains: ["x"] } },
        },
      },
      {
        id: "e",
        text: "t",
        kind: "cli",
        acceptance: { command: "npm test", expect: { exitCode: 0 } },
      },
      {
        id: "f",
        text: "t",
        kind: "ui",
        acceptance: {
          steps: [
            { action: "goto", path: "/" },
            { action: "fill_placeholder", placeholder: "Title", value: "{{nonce}}" },
            { action: "fill_role", role: "textbox", value: "{{nonce}}" },
            { action: "click_role", role: "button", name: "Add", exact: true },
            { action: "click_text", text: "Add" },
            { action: "expect_text", text: "{{nonce}}" },
          ],
        },
      },
    ];
    for (const spec of specs) {
      expect(behavioralCheckSpecSchema.safeParse(spec).success, JSON.stringify(spec)).toBe(
        true
      );
    }
  });

  it("defaults a request method to GET", () => {
    const parsed = behavioralCheckSpecSchema.parse({
      id: "a",
      text: "t",
      kind: "http",
      acceptance: { request: { path: "/notes" }, expect: { status: [200] } },
    });
    expect(parsed.kind === "http" && parsed.acceptance.request.method).toBe("GET");
  });

  it("rejects a kind it cannot execute", () => {
    const parsed = behavioralCheckSpecSchema.safeParse({
      id: "a",
      text: "t",
      kind: "websocket",
      acceptance: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a request that smuggles in its own origin, or escapes the path", () => {
    for (const path of ["http://evil.test/notes", "notes", "/../../etc/passwd"]) {
      const parsed = behavioralCheckSpecSchema.safeParse(
        httpSpec({
          acceptance: { request: { method: "GET", path }, expect: { status: [200] } },
        } as never)
      );
      expect(parsed.success, path).toBe(false);
    }
  });

  it("rejects an expectation that asserts nothing", () => {
    const parsed = behavioralCheckSpecSchema.safeParse(
      httpSpec({
        acceptance: { request: { method: "GET", path: "/notes" }, expect: {} },
      } as never)
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a one-step sequence, which is just an http check", () => {
    const parsed = behavioralCheckSpecSchema.safeParse({
      id: "a",
      text: "t",
      kind: "http_sequence",
      acceptance: {
        steps: [{ request: { path: "/notes" }, expect: { status: [200] } }],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an id that is not url-safe", () => {
    for (const id of ["has space", "", "../escape", "-leading"]) {
      expect(behavioralCheckSpecSchema.safeParse(httpSpec({ id })).success, id).toBe(false);
    }
  });

  it("reports which stored spec was rejected and why, rather than dropping it silently", () => {
    const { specs, rejected } = parseBehavioralCheckSpecs([
      httpSpec({ id: "keep" }),
      { id: "bad", text: "t", kind: "http", acceptance: { request: {}, expect: {} } },
    ]);
    expect(specs.map((s) => s.id)).toEqual(["keep"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].index).toBe(1);
    expect(rejected[0].reason.length).toBeGreaterThan(0);
  });

  it("keeps the first of two specs sharing an id and reports the collision", () => {
    const { specs, rejected } = parseBehavioralCheckSpecs([
      httpSpec({ id: "dup", text: "first" }),
      httpSpec({ id: "dup", text: "second" }),
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0].text).toBe("first");
    expect(rejected[0].reason).toContain("duplicate id");
  });

  it("treats anything that is not a list of specs as no specs at all", () => {
    for (const raw of [null, undefined, "specs", 7, { id: "a" }]) {
      expect(parseBehavioralCheckSpecs(raw)).toEqual({ specs: [], rejected: [] });
    }
  });
});

describe("resolveBehavioralCheckSpecs", () => {
  beforeEach(() => {
    delete process.env.BEHAVIORAL_DETERMINISTIC_CHECKS_ENABLED;
  });

  it("upgrades a legacy assessment's plain strings to agent checks", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["Someone can add a note.", "The list shows the note."],
    });
    expect(resolved.specs).toHaveLength(2);
    expect(resolved.specs.every((s) => s.kind === "agent")).toBe(true);
    expect(resolved.specs.map((s) => s.text)).toEqual([
      "Someone can add a note.",
      "The list shows the note.",
    ]);
    expect(resolved.rejected).toEqual([]);
    expect(resolved.orphanedSpecIds).toEqual([]);
  });

  it("gives a legacy check an id that survives reordering but not rewording", () => {
    const a = resolveBehavioralCheckSpecs({ behavioralChecks: ["One.", "Two."] });
    const reordered = resolveBehavioralCheckSpecs({ behavioralChecks: ["Two.", "One."] });
    expect(reordered.specs[1].id).toBe(a.specs[0].id);
    expect(legacyCheckId("One.")).toBe(legacyCheckId(" One. "));
    expect(legacyCheckId("One.")).not.toBe(legacyCheckId("One!"));
  });

  it("attaches a stored spec to its sentence and leaves the rest on the agent", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["Someone can add a note.", "Notes look nice."],
      behavioralCheckSpecs: [httpSpec({ id: "add", text: "Someone can add a note." })],
    });
    expect(resolved.specs[0].kind).toBe("http");
    expect(resolved.specs[0].id).toBe("add");
    expect(resolved.specs[1].kind).toBe("agent");
  });

  it("ignores a spec whose sentence was edited away, and names it as orphaned", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["Someone can add a note, quickly."],
      behavioralCheckSpecs: [httpSpec({ id: "stale", text: "Someone can add a note." })],
    });
    expect(resolved.specs[0].kind).toBe("agent");
    expect(resolved.orphanedSpecIds).toEqual(["stale"]);
  });

  it("grades the sentence the recruiter reads, not the spec's stale copy of it", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["  Someone can add a note.  "],
      behavioralCheckSpecs: [httpSpec({ id: "add", text: "Someone can add a note." })],
    });
    expect(resolved.specs[0].text).toBe("  Someone can add a note.  ");
    expect(resolved.specs[0].kind).toBe("http");
  });

  it("falls back to the agent judge everywhere when the server switch is off", () => {
    process.env.BEHAVIORAL_DETERMINISTIC_CHECKS_ENABLED = "false";
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["Someone can add a note."],
      behavioralCheckSpecs: [httpSpec({ id: "add", text: "Someone can add a note." })],
    });
    expect(resolved.specs[0].kind).toBe("agent");
    expect(resolved.specs[0].id).toBe("add");
    expect(resolved.downgradedByFlag).toBe(true);
  });

  it("drops blank and non-string checks", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: ["Real check.", "   ", 42, null],
    });
    expect(resolved.specs).toHaveLength(1);
  });

  it("returns nothing for an assessment with no checks", () => {
    expect(resolveBehavioralCheckSpecs({}).specs).toEqual([]);
  });

  it("marks every non-agent spec as deterministically checkable", () => {
    expect(isDeterministicSpec(httpSpec())).toBe(true);
    expect(isDeterministicSpec({ id: "a", text: "t", kind: "agent" })).toBe(false);
  });
});

describe("nonce substitution", () => {
  it("replaces the placeholder everywhere in a spec, including nested bodies", () => {
    const spec = applyNonce(
      httpSpec({
        acceptance: {
          request: { method: "POST", path: "/notes", json: { title: "n {{nonce}}" } },
          expect: { bodyContains: ["{{nonce}}"] },
        },
      } as never),
      "abc123"
    );
    expect(JSON.stringify(spec)).toContain("abc123");
    expect(JSON.stringify(spec)).not.toContain("{{nonce}}");
    expect(specUsesNonce(spec)).toBe(false);
  });

  it("leaves non-string values alone", () => {
    expect(applyNonce({ n: 1, ok: true, nothing: null }, "x")).toEqual({
      n: 1,
      ok: true,
      nothing: null,
    });
  });
});

describe("http acceptance", () => {
  it("matches JSON regardless of whitespace or extra fields", () => {
    expect(responseBodyContains('{"ok":true,"store":"memory"}', '"ok": true')).toBe(
      true
    );
    expect(
      responseBodyContains(
        '{"_id":"mem_1","title":"Ship runtime setup… bg-245688e2","done":false}',
        '{"title":"Ship runtime setup… bg-245688e2"}'
      )
    ).toBe(true);
    expect(jsonContainsSubset({ ok: true, store: "memory" }, { ok: true })).toBe(
      true
    );
    expect(responseBodyContains('{"ok":true}', '"ok": false')).toBe(false);
    expect(responseBodyContains('{"title":"A"}', '{"title":"B"}')).toBe(false);
  });
  it("passes when the app answers as the criteria require", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { status: [200], json: [{ path: "notes", exists: true }] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("pass");
    expect(sandbox.requests).toEqual([{ method: "GET", path: "/notes", body: "" }]);
    // The evidence has to carry a command a recruiter can re-run.
    expect(evidenceText(result)).toContain("curl");
  });

  it("fails on a status the criteria do not allow, and says what it got", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/missing" },
          expect: { status: [200] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("expected status 200");
    expect(result.rationale).toContain("404");
  });

  it("fails on missing body text and on text that should not be there", async () => {
    const sandbox = fakeSandbox({ app: notesApp("fake-pass") });
    const missing = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { bodyContains: ["Wash the car"] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(missing.verdict).toBe("fail");
    expect(missing.rationale).toContain("missing");

    const present = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { bodyNotContains: ["Buy milk"] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(present.verdict).toBe("fail");
    expect(present.rationale).toContain("should not contain");
  });

  it("treats pretty-printed JSON fragments and object subsets as present (test4)", async () => {
    const sandbox = fakeSandbox({
      app: {
        http: ({ method, path }) => {
          if (method === "GET" && path === "/health") {
            return { status: 200, body: JSON.stringify({ ok: true, store: "memory" }) };
          }
          if (method === "POST" && path === "/api/notes") {
            return {
              status: 201,
              body: JSON.stringify({
                _id: "mem_1",
                title: "Ship runtime setup… bg-245688e2",
                done: false,
              }),
            };
          }
          return { status: 404, body: JSON.stringify({ error: "Not found" }) };
        },
      },
    });

    const health = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/health" },
          expect: {
            status: [200],
            bodyContains: ["{", '"ok": true', "}"],
          },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(health.verdict).toBe("pass");

    const created = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        id: "create",
        acceptance: {
          request: { method: "POST", path: "/api/notes", json: { title: "x" } },
          expect: {
            status: [201],
            bodyContains: ['{"title":"Ship runtime setup… bg-245688e2"}'],
          },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(created.verdict).toBe("pass");
  });

  it("checks JSON paths by equality, containment, and presence", async () => {
    const app = notesApp("complete");
    const sandbox = fakeSandbox({ app });
    app.http({ method: "POST", path: "/notes", body: '{"title":"Buy milk"}' });

    const equals = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { json: [{ path: "notes.0.title", equals: "Buy milk" }] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(equals.verdict).toBe("pass");

    const wrong = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { json: [{ path: "notes.0.title", equals: "Sell milk" }] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(wrong.verdict).toBe("fail");
    expect(wrong.rationale).toContain("notes.0.title");

    const absent = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { json: [{ path: "notes.4.title", exists: true }] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(absent.verdict).toBe("fail");
    expect(absent.rationale).toContain("missing");
  });

  it("is inconclusive when the criteria ask about JSON and the app sent something else", async () => {
    const sandbox = fakeSandbox({
      app: { http: () => ({ status: 200, body: "<html>notes</html>" }) },
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { json: [{ path: "notes", exists: true }] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    // A JSON assertion against HTML says the criteria are wrong for this app —
    // that is not evidence the candidate's behavior is missing.
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("not valid JSON");
  });

  it("is inconclusive when the criteria carry a broken regular expression", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { bodyMatches: "note(" },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("not a valid regular expression");
  });

  it("is inconclusive, not a fail, when the app never answers", async () => {
    const sandbox = fakeSandbox({ app: { http: () => null } });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec(),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("no response");
  });

  it("is blocked when there is no origin to talk to", async () => {
    const sandbox = fakeSandbox();
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec(),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("blocked");
    expect(sandbox.requests).toEqual([]);
  });

  it("is inconclusive when the sandbox itself falls over", async () => {
    const sandbox = fakeSandbox({ throwOnRun: "sandbox is gone" });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec(),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
  });

  it("never routes an agent check through the deterministic runner", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: { id: "a", text: "It feels polished.", kind: "agent" },
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(sandbox.requests).toEqual([]);
  });
});

describe("http_sequence acceptance", () => {
  const sequenceSpec: BehavioralCheckSpec = {
    id: "seq",
    text: "A note that was just added shows up in the list.",
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "Add a note",
          request: { method: "POST", path: "/notes", json: { title: "Seq {{nonce}}" } },
          expect: { status: [201] },
        },
        {
          label: "Read it back",
          request: { method: "GET", path: "/notes" },
          expect: { status: [200], bodyContains: ["{{nonce}}"] },
        },
      ],
    },
  };

  it("runs the steps in order and passes when each one holds", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: sequenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("pass");
    expect(sandbox.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /notes",
      "GET /notes",
    ]);
    expect(result.evidence).toHaveLength(2);
  });

  it("catches an app that echoes a write but never stores it", async () => {
    const sandbox = fakeSandbox({ app: notesApp("fake-pass") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: sequenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("Read it back");
  });

  it("sends a per-run value, so a hardcoded response cannot satisfy the sequence", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: sequenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    const posted = sandbox.requests[0].body;
    expect(posted).not.toContain("{{nonce}}");
    expect(posted).toMatch(/Seq bg-[0-9a-f]{8}/);
  });

  it("stops at the first failing step and names it", async () => {
    const sandbox = fakeSandbox({
      app: { http: ({ method }) => (method === "POST" ? { status: 500, body: "boom" } : null) },
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: sequenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("Add a note");
    expect(sandbox.requests).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
  });

  it("numbers an unlabeled step so the report still points somewhere", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: {
        id: "seq2",
        text: "t",
        kind: "http_sequence",
        acceptance: {
          steps: [
            { request: { method: "GET", path: "/notes" }, expect: { status: [200] } },
            { request: { method: "GET", path: "/nope" }, expect: { status: [200] } },
          ],
        },
      },
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("Step 2 of 2");
  });
});

describe("restart_persistence acceptance", () => {
  const persistenceSpec: BehavioralCheckSpec = {
    id: "persist",
    text: "Notes are still there after the application is restarted.",
    kind: "restart_persistence",
    acceptance: {
      write: {
        label: "Add a note before the restart",
        request: { method: "POST", path: "/notes", json: { title: "Durable {{nonce}}" } },
        expect: { status: [201] },
      },
      read: {
        label: "Look for it after the restart",
        request: { method: "GET", path: "/notes" },
        expect: { status: [200], bodyContains: ["{{nonce}}"] },
      },
    },
  };

  it("passes when data written before a restart is there afterwards", async () => {
    const app = notesApp("complete");
    const sandbox = fakeSandbox({ app });
    const result = await withFastTimers(() =>
      runDeterministicCheck({
        ctx: sandbox.ctx,
        spec: persistenceSpec,
        sandboxAppOrigin: ORIGIN,
        repoPath: REPO,
        restartApp: async () => {
          app.restart?.();
          return { ok: true };
        },
      })
    );
    expect(result.verdict).toBe("pass");
    expect(result.rationale).toContain("persisted");
  });

  it("fails an app whose notes only live in memory", async () => {
    const app = notesApp("no-persistence");
    const sandbox = fakeSandbox({ app });
    const result = await withFastTimers(() =>
      runDeterministicCheck({
        ctx: sandbox.ctx,
        spec: persistenceSpec,
        sandboxAppOrigin: ORIGIN,
        repoPath: REPO,
        restartApp: async () => {
          app.restart?.();
          return { ok: true };
        },
      })
    );
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("was not there afterwards");
  });

  it("does not restart anything when the write itself failed", async () => {
    const sandbox = fakeSandbox({
      app: { http: () => ({ status: 500, body: "{}" }) },
    });
    const restartApp = vi.fn(async () => ({ ok: true }));
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: persistenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
      restartApp,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("Add a note before the restart");
    expect(restartApp).not.toHaveBeenCalled();
  });

  it("is inconclusive when nothing here can restart the app", async () => {
    const sandbox = fakeSandbox({ app: notesApp("complete") });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: persistenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("could not be restarted");
  });

  it("is inconclusive when the restart fails, rather than blaming the candidate", async () => {
    const app = notesApp("complete");
    const sandbox = fakeSandbox({ app });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: persistenceSpec,
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
      restartApp: async () => ({ ok: false, error: "port already bound" }),
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("port already bound");
  });

  it("is inconclusive when the app never answers again after the restart", async () => {
    let alive = true;
    const sandbox = fakeSandbox({
      app: {
        http: ({ method }) =>
          !alive ? null : method === "POST" ? { status: 201, body: "{}" } : { status: 200, body: "{}" },
      },
    });
    const result = await withFastTimers(() =>
      runDeterministicCheck({
        ctx: sandbox.ctx,
        spec: persistenceSpec,
        sandboxAppOrigin: ORIGIN,
        repoPath: REPO,
        restartApp: async () => {
          alive = false;
          return { ok: true };
        },
      })
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("never answered again");
  });
});

describe("cli acceptance", () => {
  const cliSpec = (
    command: string,
    expectation: Record<string, unknown>
  ): BehavioralCheckSpec => ({
    id: "cli",
    text: "The project's own tests pass.",
    kind: "cli",
    acceptance: { command, expect: expectation as never },
  });

  it("passes on the expected exit code and runs in the repo", async () => {
    const sandbox = fakeSandbox({
      cli: () => ({ exitCode: 0, stdout: "12 passing" }),
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: cliSpec("npm test", { exitCode: 0, stdoutContains: ["passing"] }),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("pass");
    expect(sandbox.commands).toEqual(["npm test"]);
  });

  it("fails on the wrong exit code and reports both numbers", async () => {
    const sandbox = fakeSandbox({ cli: () => ({ exitCode: 1, stdout: "1 failing" }) });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: cliSpec("npm test", { exitCode: 0 }),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("expected exit code 0, got 1");
  });

  it("reads stderr as part of the output, so a failure written there still counts", async () => {
    const sandbox = fakeSandbox({
      cli: () => ({ exitCode: 0, stdout: "", stderr: "Error: nothing ran" }),
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: cliSpec("npm test", { stdoutNotContains: ["Error"] }),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
  });

  it("is inconclusive when the criteria carry a broken pattern", async () => {
    const sandbox = fakeSandbox({ cli: () => ({ exitCode: 0, stdout: "ok" }) });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: cliSpec("npm test", { stdoutMatches: "pass(" }),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
  });

  it("does not need a running app", async () => {
    const sandbox = fakeSandbox({ cli: () => ({ exitCode: 0, stdout: "ok" }) });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: cliSpec("ls", { exitCode: 0 }),
      repoPath: REPO,
    });
    expect(result.verdict).toBe("pass");
  });
});

describe("ui acceptance", () => {
  const uiSpec = (steps: unknown[]): BehavioralCheckSpec => ({
    id: "ui",
    text: "Someone can add a note from the page.",
    kind: "ui",
    acceptance: { steps: steps as never },
  });

  it("walks the page and passes when the expected text is there", async () => {
    const sandbox = fakeSandbox();
    const browser = fakeBrowserSession({
      bodyText: "My notes\nBuy milk",
      clickable: ["Add note"],
      clickableRoles: [{ role: "button", name: "Add note" }],
      fillable: ["#title"],
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([
        { action: "goto", path: "/" },
        { action: "fill", selector: "#title", value: "Buy milk" },
        { action: "click_role", role: "button", name: "Add note", exact: true },
        { action: "expect_text", text: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("pass");
    expect(browser.actions).toEqual([
      "goto https://sandbox.example/",
      "fill #title=Buy milk",
      "click_role button Add note",
    ]);
    expect(result.evidence).toHaveLength(4);
  });

  it("fails when the page never shows what the check requires", async () => {
    const sandbox = fakeSandbox();
    const browser = fakeBrowserSession({ bodyText: "My notes" });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([{ action: "expect_text", text: "Buy milk" }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("fail");
    expect(result.rationale).toContain("never showed");
  });

  it("supports asserting text is gone", async () => {
    const sandbox = fakeSandbox();
    const gone = fakeBrowserSession({ bodyText: "My notes" });
    const stillThere = fakeBrowserSession({ bodyText: "My notes\nBuy milk" });
    const spec = uiSpec([{ action: "expect_text", text: "Buy milk", absent: true }]);

    expect(
      (
        await runDeterministicCheck({
          ctx: sandbox.ctx,
          spec,
          browserBaseUrl: "https://sandbox.example",
          browserSession: gone.session,
          repoPath: REPO,
        })
      ).verdict
    ).toBe("pass");

    const failed = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec,
      browserBaseUrl: "https://sandbox.example",
      browserSession: stillThere.session,
      repoPath: REPO,
    });
    expect(failed.verdict).toBe("fail");
    expect(failed.rationale).toContain("still showed");
  });

  it("is inconclusive when a fill or click cannot find the control", async () => {
    const sandbox = fakeSandbox();
    const browser = fakeBrowserSession({
      bodyText: "My notes",
      clickableRoles: [],
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([{ action: "click_role", role: "button", name: "Add note", exact: true }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).toContain("click_role");
    expect(result.rationale).toContain("could not be observed");

    const fillMiss = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([
        { action: "fill", selector: "input[type='text']", value: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: fakeBrowserSession({
        bodyText: "My notes",
        fillable: [],
      }).session,
      repoPath: REPO,
    });
    expect(fillMiss.verdict).toBe("inconclusive");
    expect(fillMiss.rationale).toContain("fill");
  });

  it("fills by placeholder and role without CSS", async () => {
    const sandbox = fakeSandbox();
    const browser = fakeBrowserSession({
      bodyText: "My notes\nBuy milk",
      clickableRoles: [{ role: "button", name: "Add note" }],
      fillablePlaceholders: ["Ship runtime setup…"],
      fillableRoles: ["textbox"],
    });
    const byPlaceholder = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([
        { action: "goto", path: "/" },
        {
          action: "fill_placeholder",
          placeholder: "Ship runtime setup…",
          value: "Buy milk",
        },
        { action: "click_role", role: "button", name: "Add note", exact: true },
        { action: "expect_text", text: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
    });
    expect(byPlaceholder.verdict).toBe("pass");
    expect(browser.actions).toContain("fill_placeholder Ship runtime setup…=Buy milk");

    const byRole = fakeBrowserSession({
      bodyText: "My notes\nBuy milk",
      fillableRoles: ["textbox"],
    });
    const filled = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([
        { action: "fill_role", role: "textbox", value: "Buy milk" },
        { action: "expect_text", text: "Buy milk" },
      ]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: byRole.session,
      repoPath: REPO,
    });
    expect(filled.verdict).toBe("pass");
    expect(byRole.actions).toEqual(["fill_role textbox=Buy milk"]);
  });

  it("is inconclusive when the page cannot be opened at all", async () => {
    const sandbox = fakeSandbox();
    const browser = fakeBrowserSession({ gotoError: "net::ERR_CONNECTION_REFUSED" });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([{ action: "goto", path: "/" }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: browser.session,
      repoPath: REPO,
    });
    expect(result.verdict).toBe("inconclusive");
  });

  it("is blocked when there is no browser or no URL", async () => {
    const sandbox = fakeSandbox();
    const noUrl = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([{ action: "expect_text", text: "Notes" }]),
      browserSession: fakeBrowserSession({ bodyText: "Notes" }).session,
      repoPath: REPO,
    });
    expect(noUrl.verdict).toBe("blocked");

    const noBrowser = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: uiSpec([{ action: "expect_text", text: "Notes" }]),
      browserBaseUrl: "https://sandbox.example",
      browserSession: brokenBrowserSession,
      repoPath: REPO,
    });
    expect(noBrowser.verdict).toBe("blocked");
  });
});

describe("secret redaction in acceptance evidence", () => {
  const SECRET = "sk-live-9f8a7b6c5d4e";

  it("keeps a candidate secret out of a recorded response", async () => {
    const sandbox = fakeSandbox({
      app: { http: () => ({ status: 200, body: `{"notes":[],"token":"${SECRET}"}` }) },
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec({
        acceptance: {
          request: { method: "GET", path: "/notes" },
          expect: { status: [200] },
        },
      } as never),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
      secrets: [SECRET],
    });
    expect(result.verdict).toBe("pass");
    const recorded = evidenceText(result);
    expect(recorded).not.toContain(SECRET);
    expect(recorded).toContain("[redacted]");
  });

  it("keeps a secret out of command output", async () => {
    const sandbox = fakeSandbox({
      cli: () => ({ exitCode: 0, stdout: `connected with ${SECRET}` }),
    });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: {
        id: "cli",
        text: "The seed script runs.",
        kind: "cli",
        acceptance: { command: "npm run seed", expect: { exitCode: 0 } },
      },
      repoPath: REPO,
      secrets: [SECRET],
    });
    expect(evidenceText(result)).not.toContain(SECRET);
  });

  it("keeps a secret out of the message when the app fails to answer", async () => {
    const sandbox = fakeSandbox({ throwOnRun: `connect ${SECRET} refused` });
    const result = await runDeterministicCheck({
      ctx: sandbox.ctx,
      spec: httpSpec(),
      sandboxAppOrigin: ORIGIN,
      repoPath: REPO,
      secrets: [SECRET],
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.rationale).not.toContain(SECRET);
  });
});

describe("the eval harness acceptance specs", () => {
  it("has a valid spec for every check, keyed to its exact sentence", () => {
    expect(BEHAVIORAL_CHECK_SPECS).toHaveLength(BEHAVIORAL_CHECKS.length);
    BEHAVIORAL_CHECK_SPECS.forEach((spec, i) => {
      expect(behavioralCheckSpecSchema.safeParse(spec).success, spec.id).toBe(true);
      expect(spec.text).toBe(BEHAVIORAL_CHECKS[i]);
      expect(spec.kind).not.toBe("agent");
    });
    const ids = BEHAVIORAL_CHECK_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves onto the harness assessment without falling back to the agent", () => {
    const resolved = resolveBehavioralCheckSpecs({
      behavioralChecks: BEHAVIORAL_CHECKS,
      behavioralCheckSpecs: BEHAVIORAL_CHECK_SPECS,
    });
    expect(resolved.specs.map((s) => s.kind)).toEqual(
      BEHAVIORAL_CHECK_SPECS.map((s) => s.kind)
    );
    expect(resolved.orphanedSpecIds).toEqual([]);
    expect(resolved.rejected).toEqual([]);
  });

  it("checks stored data through a per-run value wherever it can be faked", () => {
    for (const spec of BEHAVIORAL_CHECK_SPECS) {
      if (spec.kind === "http_sequence" || spec.kind === "restart_persistence") {
        expect(specUsesNonce(spec), spec.id).toBe(true);
      }
    }
  });

  /**
   * The ground-truth matrix from the eval harness, reproduced against in-memory
   * versions of each fixture variant. This is the assertion that the acceptance
   * specs — not just the agent judge — earn the harness's zero-false-pass gate,
   * and it runs without a sandbox so a regression surfaces in CI rather than in
   * a twenty-minute eval.
   */
  const runnableVariants: Array<Exclude<FixtureVariant, "wont-boot">> = [
    "complete",
    "no-persistence",
    "no-validation",
    "fake-pass",
  ];

  for (const variant of runnableVariants) {
    it(`produces the expected verdicts for the ${variant} fixture`, async () => {
      const app = notesApp(variant);
      const sandbox = fakeSandbox({ app });
      const verdicts: string[] = [];

      for (const spec of BEHAVIORAL_CHECK_SPECS) {
        const result = await withFastTimers(() =>
          runDeterministicCheck({
            ctx: sandbox.ctx,
            spec,
            sandboxAppOrigin: ORIGIN,
            repoPath: REPO,
            restartApp: async () => {
              app.restart?.();
              return { ok: true };
            },
          })
        );
        verdicts.push(result.verdict);
      }

      expect(verdicts).toEqual(VARIANT_SPECS[variant].expected);
      // The metric that matters: nothing was credited that the fixture lacks.
      VARIANT_SPECS[variant].expected.forEach((expected, i) => {
        if (expected !== "pass") expect(verdicts[i]).not.toBe("pass");
      });
    });
  }

  it("blocks every check, and scores nothing, when the app never came up", async () => {
    const sandbox = fakeSandbox();
    const verdicts: string[] = [];
    for (const spec of BEHAVIORAL_CHECK_SPECS) {
      const result = await runDeterministicCheck({
        ctx: sandbox.ctx,
        spec,
        repoPath: REPO,
      });
      verdicts.push(result.verdict);
    }
    expect(verdicts).toEqual(VARIANT_SPECS["wont-boot"].expected);

    // And the scoring rules turn that into "not enough was verified" rather than
    // a middling percentage.
    const score = computeBehavioralScore(verdicts.map((verdict) => ({ verdict })));
    expect(score.blocked).toBe(BEHAVIORAL_CHECK_SPECS.length);
    expect(score.decided).toBe(0);
    expect(score.passRate).toBeNull();
  });

  it("scores a partly broken fixture off the checks it actually decided", async () => {
    const app = notesApp("no-validation");
    const sandbox = fakeSandbox({ app });
    const cases: Array<{ verdict: string }> = [];
    for (const spec of BEHAVIORAL_CHECK_SPECS) {
      const result = await withFastTimers(() =>
        runDeterministicCheck({
          ctx: sandbox.ctx,
          spec,
          sandboxAppOrigin: ORIGIN,
          repoPath: REPO,
          restartApp: async () => {
            app.restart?.();
            return { ok: true };
          },
        })
      );
      cases.push({ verdict: result.verdict });
    }
    const score = computeBehavioralScore(cases);
    expect(score.decided).toBe(5);
    expect(score.passed).toBe(4);
    expect(score.failed).toBe(1);
    expect(score.passRate).toBe(80);
  });
});
