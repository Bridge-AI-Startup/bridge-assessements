/**
 * Settle a behavioral check by observation instead of by inference.
 *
 * When a check carries an acceptance spec, this module makes the requests, runs
 * the command, or drives the browser itself and compares the result against the
 * spec. There is **no LLM call anywhere in this file** — that is the entire point:
 * the verdict is a recorded request and its response, so a recruiter defending it
 * can re-run the same curl, and a rejected candidate can be shown exactly what
 * came back.
 *
 * Verdict mapping is deliberately conservative:
 *
 *  - assertion mismatch → `fail` (we observed the app disagree with the spec)
 *  - no origin / no browser → `blocked` (nothing could be observed)
 *  - transport error, unparseable response, failed restart → `inconclusive`
 *
 * We never turn "we could not look" into a fail. Anything genuinely ambiguous
 * belongs to the agent judge, which callers reach by leaving `kind: "agent"`.
 */

import { randomUUID } from "crypto";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { bashLc } from "./artifacts.js";
import type { BehavioralBrowserSession } from "./browserSession.js";
import {
  applyNonce,
  type BehavioralCheckSpec,
  type CliExpectation,
  type HttpExpectation,
  type HttpStepSpec,
  type UiStepSpec,
} from "./checkSpecs.js";
import type { StepEvidence } from "./executor.js";
import { behavioralInfo } from "./log.js";
import { redactSecrets } from "../runtimeSetup/secrets.js";

const STATUS_MARKER = "__BG_STATUS__";
const HTTP_TIMEOUT_MS = 25_000;
const CLI_TIMEOUT_MS = 120_000;
const BODY_SNIPPET_MAX = 1600;
/** Long enough for a Node/Python process to rebind its port after a restart. */
const RESTART_SETTLE_MS = 1500;
const RESTART_READY_ATTEMPTS = 12;

export type DeterministicVerdict = "pass" | "fail" | "inconclusive" | "blocked";

export type DeterministicRunResult = {
  verdict: DeterministicVerdict;
  rationale: string;
  /** Raw request/response (or command, or UI step) records, in execution order. */
  evidence: StepEvidence[];
  citations: string[];
};

export type DeterministicRunInput = {
  ctx: GradingSandboxContext;
  /** Never `kind: "agent"` — callers must route those to the agent judge. */
  spec: BehavioralCheckSpec;
  /** In-sandbox origin (e.g. http://127.0.0.1:5070) for HTTP acceptance. */
  sandboxAppOrigin?: string;
  /** Public sandbox URL for UI acceptance. */
  browserBaseUrl?: string;
  browserSession?: BehavioralBrowserSession;
  repoPath: string;
  /** Candidate secret values, scrubbed out of every recorded snippet. */
  secrets?: string[];
  /** Restart the app in place. Required for `restart_persistence`. */
  restartApp?: () => Promise<{ ok: boolean; error?: string }>;
};

type HttpOutcome =
  | {
      kind: "response";
      status: number;
      body: string;
      /** Rendered curl for citations — the reader's reproduction instruction. */
      curl: string;
    }
  | { kind: "transport_error"; detail: string; curl: string };

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderCurl(origin: string, step: HttpStepSpec): string {
  const { method, path, headers, json, body } = step.request;
  const parts = [`curl -sS -X ${method}`, shellSingleQuote(`${origin}${path}`)];
  if (json !== undefined) {
    parts.push(`-H 'Content-Type: application/json'`);
    parts.push(`-d ${shellSingleQuote(JSON.stringify(json))}`);
  } else if (body) {
    parts.push(`-d ${shellSingleQuote(body)}`);
  }
  for (const [k, v] of Object.entries(headers ?? {})) {
    parts.push(`-H ${shellSingleQuote(`${k}: ${v}`)}`);
  }
  return parts.join(" ");
}

/**
 * One request from inside the sandbox.
 *
 * Status comes from curl's own `%{http_code}` rather than from parsing headers:
 * a body containing something that looks like a status line would otherwise be
 * able to fake the result, which is exactly the class of pass this work exists to
 * eliminate.
 */
async function httpRequest(
  ctx: GradingSandboxContext,
  origin: string,
  step: HttpStepSpec
): Promise<HttpOutcome> {
  const { method, path, headers, json, body } = step.request;
  const url = `${origin}${path}`;
  const args = [
    "curl -sS -m 15",
    `-X ${method}`,
    shellSingleQuote(url),
    `-o "$BG_RESP"`,
    `-w ${shellSingleQuote(`${STATUS_MARKER}%{http_code}`)}`,
  ];
  if (json !== undefined) {
    args.push(`-H 'Content-Type: application/json'`);
    args.push(`-d ${shellSingleQuote(JSON.stringify(json))}`);
  } else if (body) {
    args.push(`-d ${shellSingleQuote(body)}`);
  }
  for (const [k, v] of Object.entries(headers ?? {})) {
    args.push(`-H ${shellSingleQuote(`${k}: ${v}`)}`);
  }

  const script = `BG_RESP=$(mktemp); ${args.join(
    " "
  )}; echo ""; cat "$BG_RESP"; rm -f "$BG_RESP"`;
  const curl = renderCurl(origin, step);

  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  try {
    const r = await ctx.run(bashLc(script), {
      cwd: "/",
      timeoutMs: HTTP_TIMEOUT_MS,
    });
    stdout = r.stdout || "";
    stderr = r.stderr || "";
    exitCode = r.exitCode;
  } catch (e) {
    return {
      kind: "transport_error",
      detail: e instanceof Error ? e.message : String(e),
      curl,
    };
  }

  const match = stdout.match(new RegExp(`${STATUS_MARKER}(\\d{3})`));
  if (!match) {
    return {
      kind: "transport_error",
      detail:
        stderr.trim() ||
        `curl produced no status (exit ${exitCode}); the app did not answer`,
      curl,
    };
  }
  const status = Number(match[1]);
  const bodyStart = stdout.indexOf("\n", match.index ?? 0);
  const responseBody = bodyStart >= 0 ? stdout.slice(bodyStart + 1) : "";
  if (status === 0) {
    return {
      kind: "transport_error",
      detail: stderr.trim() || "connection failed",
      curl,
    };
  }
  return { kind: "response", status, body: responseBody, curl };
}

/** Resolve a dotted path with numeric indices, e.g. `notes.0.title`. */
function resolveJsonPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const rawKey of path.split(".")) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(rawKey);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[rawKey];
  }
  return cursor;
}

function safeRegexTest(pattern: string, value: string): boolean | null {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return null;
  }
}

type AssertionResult = { ok: boolean; failures: string[]; unreadable?: string };

function checkHttpExpectation(
  expectation: HttpExpectation,
  status: number,
  body: string
): AssertionResult {
  const failures: string[] = [];

  if (expectation.status?.length && !expectation.status.includes(status)) {
    failures.push(
      `expected status ${expectation.status.join(" or ")}, got ${status}`
    );
  }
  for (const needle of expectation.bodyContains ?? []) {
    if (!body.includes(needle)) failures.push(`response is missing "${needle}"`);
  }
  for (const needle of expectation.bodyNotContains ?? []) {
    if (body.includes(needle)) {
      failures.push(`response should not contain "${needle}"`);
    }
  }
  if (expectation.bodyMatches) {
    const matched = safeRegexTest(expectation.bodyMatches, body);
    if (matched === null) {
      return {
        ok: false,
        failures,
        unreadable: `acceptance pattern is not a valid regular expression: ${expectation.bodyMatches}`,
      };
    }
    if (!matched) {
      failures.push(`response does not match /${expectation.bodyMatches}/`);
    }
  }

  if (expectation.json?.length) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return {
        ok: false,
        failures,
        unreadable:
          "acceptance asserts on JSON fields but the response was not valid JSON",
      };
    }
    for (const rule of expectation.json) {
      const actual = resolveJsonPath(parsed, rule.path);
      if (rule.exists && actual === undefined) {
        failures.push(`${rule.path} is missing`);
        continue;
      }
      if (rule.equals !== undefined && actual !== rule.equals) {
        failures.push(
          `${rule.path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(rule.equals)}`
        );
      }
      if (rule.contains !== undefined) {
        const text = typeof actual === "string" ? actual : JSON.stringify(actual);
        if (!text || !text.includes(rule.contains)) {
          failures.push(`${rule.path} does not contain "${rule.contains}"`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

function checkCliExpectation(
  expectation: CliExpectation,
  exitCode: number,
  stdout: string
): AssertionResult {
  const failures: string[] = [];
  if (expectation.exitCode != null && exitCode !== expectation.exitCode) {
    failures.push(`expected exit code ${expectation.exitCode}, got ${exitCode}`);
  }
  for (const needle of expectation.stdoutContains ?? []) {
    if (!stdout.includes(needle)) failures.push(`output is missing "${needle}"`);
  }
  for (const needle of expectation.stdoutNotContains ?? []) {
    if (stdout.includes(needle)) failures.push(`output should not contain "${needle}"`);
  }
  if (expectation.stdoutMatches) {
    const matched = safeRegexTest(expectation.stdoutMatches, stdout);
    if (matched === null) {
      return {
        ok: false,
        failures,
        unreadable: `acceptance pattern is not a valid regular expression: ${expectation.stdoutMatches}`,
      };
    }
    if (!matched) failures.push(`output does not match /${expectation.stdoutMatches}/`);
  }
  return { ok: failures.length === 0, failures };
}

/** Bundles the per-step bookkeeping every acceptance kind repeats. */
class EvidenceLog {
  readonly entries: StepEvidence[] = [];
  readonly citations: string[] = [];

  /**
   * Public because rationales need it too: the rationale is the sentence the
   * recruiter reads, so scrubbing only the evidence would leak a candidate's
   * secret into the most visible field on the page.
   */
  constructor(readonly scrub: (text: string) => string) {}

  http(
    label: string,
    step: HttpStepSpec,
    outcome: HttpOutcome,
    startedAt: string,
    success: boolean,
    note?: string
  ): void {
    const finishedAt = new Date().toISOString();
    const request = `${step.request.method} ${step.request.path}`;
    if (outcome.kind === "transport_error") {
      this.entries.push({
        id: randomUUID(),
        type: "http",
        input: { label, request, expect: step.expect, curl: outcome.curl },
        startedAt,
        finishedAt,
        success: false,
        error: this.scrub(outcome.detail),
      });
      this.citations.push(`${request} — no response (${this.scrub(outcome.detail)})`);
      return;
    }
    const body = this.scrub(outcome.body);
    this.entries.push({
      id: randomUUID(),
      type: "http",
      input: { label, request, expect: step.expect, curl: outcome.curl },
      startedAt,
      finishedAt,
      success,
      http: { status: outcome.status, bodySnippet: body.slice(0, BODY_SNIPPET_MAX) },
      ...(note ? { error: note } : {}),
    });
    this.citations.push(
      `${request} → ${outcome.status} ${body.slice(0, 200).replace(/\s+/g, " ").trim()}`
    );
  }

  command(
    input: Record<string, unknown>,
    startedAt: string,
    success: boolean,
    exitCode: number,
    stdout: string,
    stderr: string
  ): void {
    this.entries.push({
      id: randomUUID(),
      type: "command",
      input,
      startedAt,
      finishedAt: new Date().toISOString(),
      success,
      exitCode,
      stdoutSnippet: this.scrub(stdout).slice(0, BODY_SNIPPET_MAX),
      stderrSnippet: this.scrub(stderr).slice(0, BODY_SNIPPET_MAX),
    });
  }

  ui(
    input: Record<string, unknown>,
    startedAt: string,
    success: boolean,
    detail: string
  ): void {
    this.entries.push({
      id: randomUUID(),
      type: "ui",
      input,
      startedAt,
      finishedAt: new Date().toISOString(),
      success,
      stdoutSnippet: this.scrub(detail).slice(0, BODY_SNIPPET_MAX),
    });
    this.citations.push(detail.slice(0, 200));
  }
}

function fail(log: EvidenceLog, rationale: string): DeterministicRunResult {
  return { verdict: "fail", rationale, evidence: log.entries, citations: log.citations };
}

function pass(log: EvidenceLog, rationale: string): DeterministicRunResult {
  return { verdict: "pass", rationale, evidence: log.entries, citations: log.citations };
}

function undecided(
  log: EvidenceLog,
  verdict: "inconclusive" | "blocked",
  rationale: string
): DeterministicRunResult {
  return { verdict, rationale, evidence: log.entries, citations: log.citations };
}

/**
 * What a step is called in the report. An employer who labeled the step wrote
 * the words the recruiter should read; the fallback is only for unlabeled ones.
 */
function stepLabel(step: HttpStepSpec, fallback: string): string {
  return step.label?.trim() || fallback;
}

/** Run one HTTP step and fold the result into a verdict, or null to continue. */
async function runHttpStep(
  ctx: GradingSandboxContext,
  origin: string,
  step: HttpStepSpec,
  label: string,
  log: EvidenceLog
): Promise<DeterministicRunResult | null> {
  const startedAt = new Date().toISOString();
  const outcome = await httpRequest(ctx, origin, step);
  if (outcome.kind === "transport_error") {
    behavioralInfo("deterministic_step", {
      kind: "http",
      method: step.request.method,
      path: step.request.path,
      timeout: true,
    });
    log.http(label, step, outcome, startedAt, false);
    return undecided(
      log,
      "inconclusive",
      `${label}: ${step.request.method} ${step.request.path} got no response (${log.scrub(
        outcome.detail
      )}), so this behavior could not be observed.`
    );
  }
  const assertion = checkHttpExpectation(step.expect, outcome.status, outcome.body);
  behavioralInfo("deterministic_step", {
    kind: "http",
    method: step.request.method,
    path: step.request.path,
    status: outcome.status,
    ok: assertion.ok,
  });
  log.http(label, step, outcome, startedAt, assertion.ok, assertion.unreadable);
  if (assertion.unreadable) {
    return undecided(log, "inconclusive", `${label}: ${assertion.unreadable}.`);
  }
  if (!assertion.ok) {
    // Failure text can quote response values, so it goes through the scrubber too.
    return fail(log, `${label}: ${log.scrub(assertion.failures.join("; "))}.`);
  }
  return null;
}

/** Poll until the app answers again after a restart. */
async function waitForOriginBack(
  ctx: GradingSandboxContext,
  origin: string,
  probe: HttpStepSpec
): Promise<boolean> {
  for (let attempt = 0; attempt < RESTART_READY_ATTEMPTS; attempt += 1) {
    await new Promise((r) => setTimeout(r, RESTART_SETTLE_MS));
    const outcome = await httpRequest(ctx, origin, probe);
    if (outcome.kind === "response") return true;
  }
  return false;
}

export function isDeterministicallyCheckable(spec: BehavioralCheckSpec): boolean {
  return spec.kind !== "agent";
}

/**
 * Execute an acceptance spec. Never throws: an unexpected error becomes
 * `inconclusive`, because a crash in the harness is not evidence about the
 * candidate.
 */
export async function runDeterministicCheck(
  input: DeterministicRunInput
): Promise<DeterministicRunResult> {
  const { ctx, sandboxAppOrigin, browserBaseUrl, browserSession, repoPath } = input;
  const secrets = input.secrets ?? [];
  const scrub = (text: string) =>
    secrets.length ? redactSecrets(text, secrets) : text;
  const log = new EvidenceLog(scrub);

  // A value invented now, so an app that returns hardcoded fixtures cannot
  // satisfy a check about data it was asked to store.
  const nonce = `bg-${randomUUID().slice(0, 8)}`;
  const spec = applyNonce(input.spec, nonce);

  behavioralInfo("deterministic_check_start", {
    checkId: spec.id,
    kind: spec.kind,
    hasOrigin: Boolean(sandboxAppOrigin),
  });

  try {
    if (spec.kind === "agent") {
      // Callers route these to the agent judge; reaching here means a bug there,
      // and an undecided check is the only honest thing to report.
      return undecided(
        log,
        "inconclusive",
        "This check has no acceptance criteria to run."
      );
    }

    if (spec.kind === "cli") {
      const startedAt = new Date().toISOString();
      const r = await ctx.run(bashLc(spec.acceptance.command), {
        cwd: repoPath,
        timeoutMs: CLI_TIMEOUT_MS,
      });
      behavioralInfo("deterministic_step", {
        kind: "cli",
        exitCode: r.exitCode,
      });
      const stdout = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`;
      const assertion = checkCliExpectation(
        spec.acceptance.expect,
        r.exitCode,
        stdout
      );
      log.command(
        { command: spec.acceptance.command, expect: spec.acceptance.expect },
        startedAt,
        assertion.ok,
        r.exitCode,
        r.stdout || "",
        r.stderr || ""
      );
      log.citations.push(
        `$ ${spec.acceptance.command} → exit ${r.exitCode}: ${scrub(stdout)
          .slice(0, 200)
          .replace(/\s+/g, " ")
          .trim()}`
      );
      if (assertion.unreadable) {
        return undecided(log, "inconclusive", assertion.unreadable);
      }
      return assertion.ok
        ? pass(log, `Ran \`${spec.acceptance.command}\` and it met the criteria.`)
        : fail(log, `${scrub(assertion.failures.join("; "))}.`);
    }

    if (spec.kind === "ui") {
      if (!browserBaseUrl?.trim() || !browserSession) {
        return undecided(
          log,
          "blocked",
          "No browsable app URL was available, so this behavior could not be observed."
        );
      }
      return await runUiSpec(spec.acceptance.steps, browserBaseUrl, browserSession, log);
    }

    // Everything below drives HTTP against the in-sandbox origin.
    if (!sandboxAppOrigin?.trim()) {
      return undecided(
        log,
        "blocked",
        "The app was never reachable over HTTP, so this behavior could not be observed."
      );
    }

    if (spec.kind === "http") {
      const outcome = await runHttpStep(
        ctx,
        sandboxAppOrigin,
        spec.acceptance,
        "Request",
        log
      );
      return (
        outcome ??
        pass(
          log,
          `${spec.acceptance.request.method} ${spec.acceptance.request.path} responded as required.`
        )
      );
    }

    if (spec.kind === "http_sequence") {
      const steps = spec.acceptance.steps;
      for (let i = 0; i < steps.length; i += 1) {
        const outcome = await runHttpStep(
          ctx,
          sandboxAppOrigin,
          steps[i],
          stepLabel(steps[i], `Step ${i + 1} of ${steps.length}`),
          log
        );
        if (outcome) return outcome;
      }
      return pass(log, `All ${steps.length} requests responded as required, in order.`);
    }

    // restart_persistence: write, restart the app, read it back.
    const writeOutcome = await runHttpStep(
      ctx,
      sandboxAppOrigin,
      spec.acceptance.write,
      stepLabel(spec.acceptance.write, "Write"),
      log
    );
    if (writeOutcome) return writeOutcome;

    if (!input.restartApp) {
      return undecided(
        log,
        "inconclusive",
        "The app could not be restarted here, so persistence across a restart was not tested."
      );
    }
    const restarted = await input.restartApp();
    if (!restarted.ok) {
      return undecided(
        log,
        "inconclusive",
        `The app did not come back up after a restart (${scrub(
          restarted.error ?? "unknown error"
        )}), so persistence could not be judged.`
      );
    }
    const back = await waitForOriginBack(ctx, sandboxAppOrigin, spec.acceptance.read);
    if (!back) {
      return undecided(
        log,
        "inconclusive",
        "The app never answered again after being restarted, so persistence could not be judged."
      );
    }

    const readOutcome = await runHttpStep(
      ctx,
      sandboxAppOrigin,
      spec.acceptance.read,
      stepLabel(spec.acceptance.read, "Read back after restart"),
      log
    );
    if (readOutcome) {
      // A read that fails *after* a successful write is the finding, not a defect
      // in the harness: the data did not survive the restart.
      return readOutcome.verdict === "fail"
        ? fail(
            log,
            `Data written before the restart was not there afterwards — ${readOutcome.rationale}`
          )
        : readOutcome;
    }
    return pass(
      log,
      "Data written before the restart was still there afterwards, so it is genuinely persisted."
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    behavioralInfo("deterministic_check_error", { checkId: spec.id, detail });
    return undecided(
      log,
      "inconclusive",
      `The acceptance criteria could not be run: ${scrub(detail)}`
    );
  }
}

async function runUiSpec(
  steps: UiStepSpec[],
  baseUrl: string,
  session: BehavioralBrowserSession,
  log: EvidenceLog
): Promise<DeterministicRunResult> {
  let page;
  try {
    page = await session.getPage(baseUrl);
  } catch (e) {
    return undecided(
      log,
      "blocked",
      `No browser was available (${e instanceof Error ? e.message : String(e)}), so this behavior could not be observed.`
    );
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const startedAt = new Date().toISOString();
    const label = `Step ${i + 1} of ${steps.length}`;
    try {
      if (step.action === "goto") {
        const url = `${baseUrl.replace(/\/$/, "")}${step.path}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        behavioralInfo("deterministic_step", {
          kind: "ui",
          action: "goto",
          path: step.path,
        });
        log.ui({ label, action: "goto", path: step.path }, startedAt, true, `Opened ${url}`);
        continue;
      }
      if (step.action === "click_text") {
        await page
          .getByText(step.text, { exact: false })
          .first()
          .click({ timeout: 10_000 });
        log.ui(
          { label, action: "click_text", text: step.text },
          startedAt,
          true,
          `Clicked "${step.text}"`
        );
        continue;
      }
      if (step.action === "fill") {
        await page.fill(step.selector, step.value, { timeout: 10_000 });
        log.ui(
          { label, action: "fill", selector: step.selector },
          startedAt,
          true,
          `Filled ${step.selector}`
        );
        continue;
      }

      // expect_text — the only step that can produce a fail rather than an error.
      const body = (await page.locator("body").innerText({ timeout: 10_000 })) || "";
      const present = body.includes(step.text);
      const satisfied = step.absent ? !present : present;
      log.ui(
        { label, action: "expect_text", text: step.text, absent: Boolean(step.absent) },
        startedAt,
        satisfied,
        satisfied
          ? `Page ${step.absent ? "did not show" : "showed"} "${step.text}"`
          : `Page ${step.absent ? "still showed" : "never showed"} "${step.text}"`
      );
      if (!satisfied) {
        return fail(
          log,
          `The page ${step.absent ? "still showed" : "never showed"} "${step.text}" after ${i} earlier step(s).`
        );
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      log.ui({ label, action: step.action }, startedAt, false, detail);
      // A missing button or an unreachable page is the app not offering the
      // interface the spec describes — a fail, not a harness problem.
      return step.action === "goto"
        ? undecided(
            log,
            "inconclusive",
            `The page could not be opened (${log.scrub(detail)}), so this behavior could not be observed.`
          )
        : fail(
            log,
            `${label} (${step.action}) could not be completed: ${log.scrub(detail)}`
          );
    }
  }

  return pass(log, "Every step of the acceptance walkthrough behaved as required.");
}
