/**
 * Phase 6 — fault attribution: per-step runbook timeouts, in-flight dedupe,
 * and the boot-time sweep of abandoned `pending` grades.
 *
 * Nothing here talks to E2B or Mongo. The sandbox is a fake that can hang
 * until the timeout it was given, which is how we prove a hung install is
 * recorded as a grading time limit rather than thrown as a crash.
 */

process.env.BEHAVIORAL_GRADING_LOG = "0";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

import type { GradingSandboxContext } from "../../src/services/e2b/graderSandbox.js";
import type { RunbookPlan, RunbookStep } from "../../src/services/behavioralGrading/schema.js";
import {
  executeRunbook,
  MAX_STEP_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  RUNBOOK_STEP_TIMEOUT_MS,
  stepTimeoutMs,
} from "../../src/services/behavioralGrading/executor.js";

const updateMany = vi.hoisted(() => vi.fn());

vi.mock("../../src/models/submission.js", () => ({
  default: { updateMany },
}));

const {
  claimBehavioralGradingRun,
  isBehavioralGradingInFlight,
  releaseBehavioralGradingRun,
  sweepInterruptedBehavioralGrading,
} = await import("../../src/services/behavioralGrading/index.js");

const REPO = "/home/user/repo";

function step(
  purpose: RunbookStep["purpose"],
  command: string,
  extra: Partial<RunbookStep> = {}
): RunbookStep {
  return { purpose, command, origin: "readme", ...extra };
}

function plan(steps: RunbookStep[]): RunbookPlan {
  return {
    steps,
    portsHint: [],
    executionProfile: "unclear",
    readmeCoverage: {
      hasInstallCommand: steps.some((s) => s.purpose === "install"),
      hasTestCommand: steps.some((s) => s.purpose === "test"),
      hasStartCommand: steps.some((s) => s.purpose === "start"),
      notes: "",
    },
  };
}

type RunCall = { cmd: string; timeoutMs?: number; cwd?: string };

function fakeSandbox(options: {
  /** Hang until opts.timeoutMs, then throw a deadline error (E2B-style). */
  hangIf?: (cmd: string) => boolean;
  /** Optional extra delay before a successful command resolves. */
  delayIf?: (cmd: string) => number;
} = {}) {
  const calls: RunCall[] = [];
  const run = async (
    cmd: string,
    opts?: { timeoutMs?: number; cwd?: string }
  ) => {
    calls.push({ cmd, timeoutMs: opts?.timeoutMs, cwd: opts?.cwd });
    if (options.hangIf?.(cmd)) {
      const ms = opts?.timeoutMs ?? 30_000;
      await new Promise((resolve) => setTimeout(resolve, ms));
      throw new Error("Command timed out after deadline");
    }
    const delayMs = options.delayIf?.(cmd) ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
  return {
    ctx: {
      sandboxId: "sbx-test",
      sandbox: {},
      run,
    } as unknown as GradingSandboxContext,
    calls,
  };
}

function commandEvidence(result: Awaited<ReturnType<typeof executeRunbook>>) {
  return result.evidence.filter((e) => e.type === "command");
}

describe("stepTimeoutMs", () => {
  const install = step("install", "npm install");
  const setup = step("setup", "npm run build");
  const start = step("start", "npm start");
  const testStep = step("test", "npm test");

  it("uses the per-purpose defaults when the planner omitted a timeout", () => {
    expect(stepTimeoutMs(install)).toBe(RUNBOOK_STEP_TIMEOUT_MS.install);
    expect(stepTimeoutMs(setup)).toBe(RUNBOOK_STEP_TIMEOUT_MS.setup);
    expect(stepTimeoutMs(testStep)).toBe(RUNBOOK_STEP_TIMEOUT_MS.test);
    expect(stepTimeoutMs(start)).toBe(RUNBOOK_STEP_TIMEOUT_MS.start);
  });

  it("caps a planner-supplied timeout at MAX_STEP_TIMEOUT_MS", () => {
    expect(stepTimeoutMs(step("install", "npm install", { timeoutMs: 60 * 60 * 1000 }))).toBe(
      MAX_STEP_TIMEOUT_MS
    );
    expect(stepTimeoutMs(step("setup", "make", { timeoutMs: MAX_STEP_TIMEOUT_MS + 1 }))).toBe(
      MAX_STEP_TIMEOUT_MS
    );
  });

  it("gives the remaining budget when it is smaller than the step default", () => {
    expect(stepTimeoutMs(install, 12_000)).toBe(12_000);
    expect(stepTimeoutMs(setup, 45_000)).toBe(45_000);
  });

  it("floors a tiny remaining budget at MIN_STEP_TIMEOUT_MS", () => {
    expect(stepTimeoutMs(install, 1_000)).toBe(MIN_STEP_TIMEOUT_MS);
    expect(stepTimeoutMs(start, 0)).toBe(RUNBOOK_STEP_TIMEOUT_MS.start);
  });
});

describe("executeRunbook timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a hung command as timed out instead of throwing", async () => {
    vi.useFakeTimers();
    const { ctx, calls } = fakeSandbox({
      hangIf: (cmd) => cmd.includes("npm install"),
    });
    const pending = executeRunbook(
      ctx,
      plan([step("install", "npm install")]),
      REPO
    );
    await vi.advanceTimersByTimeAsync(RUNBOOK_STEP_TIMEOUT_MS.install);
    const result = await pending;

    expect(calls).toHaveLength(1);
    const [entry] = commandEvidence(result);
    expect(entry.success).toBe(false);
    expect(entry.input.timedOut).toBe(true);
    expect(entry.input.purpose).toBe("install");
    expect(String(entry.error)).toMatch(/time limit on the grading run/i);
    expect(String(entry.error)).not.toMatch(/npm ERR/i);
  });

  it("does not run later steps after a timed-out install", async () => {
    vi.useFakeTimers();
    const { ctx, calls } = fakeSandbox({
      hangIf: (cmd) => cmd.includes("npm install"),
    });
    const pending = executeRunbook(
      ctx,
      plan([
        step("install", "npm install"),
        step("setup", "npm run build"),
        step("start", "npm start"),
      ]),
      REPO
    );
    await vi.advanceTimersByTimeAsync(RUNBOOK_STEP_TIMEOUT_MS.install);
    const result = await pending;

    expect(calls.every((c) => c.cmd.includes("npm install"))).toBe(true);
    expect(calls.some((c) => c.cmd.includes("npm run build"))).toBe(false);
    expect(calls.some((c) => c.cmd.includes("npm start"))).toBe(false);
    expect(commandEvidence(result).map((e) => e.input.purpose)).toEqual(["install"]);
  });

  it("does not run later steps after a timed-out setup/build either", async () => {
    vi.useFakeTimers();
    const { ctx, calls } = fakeSandbox({
      hangIf: (cmd) => cmd.includes("npm run build"),
    });
    const pending = executeRunbook(
      ctx,
      plan([
        step("install", "npm install"),
        step("setup", "npm run build"),
        step("start", "npm start"),
      ]),
      REPO
    );
    await vi.advanceTimersByTimeAsync(RUNBOOK_STEP_TIMEOUT_MS.setup);
    const result = await pending;

    expect(calls.some((c) => c.cmd.includes("npm start"))).toBe(false);
    expect(commandEvidence(result).map((e) => e.input.purpose)).toEqual([
      "install",
      "setup",
    ]);
    expect(commandEvidence(result)[1].input.timedOut).toBe(true);
  });

  it("does not abort later steps when a detached start times out", async () => {
    vi.useFakeTimers();
    const { ctx, calls } = fakeSandbox({
      hangIf: (cmd) => cmd.includes("nohup") || cmd.includes("npm start"),
    });
    const pending = executeRunbook(
      ctx,
      plan([
        step("start", "npm start"),
        step("setup", "echo after-start"),
      ]),
      REPO
    );
    await vi.advanceTimersByTimeAsync(RUNBOOK_STEP_TIMEOUT_MS.start);
    const result = await pending;

    expect(calls.some((c) => c.cmd.includes("echo after-start"))).toBe(true);
    const purposes = commandEvidence(result).map((e) => e.input.purpose);
    expect(purposes).toEqual(["start", "setup"]);
    expect(commandEvidence(result)[0].input.timedOut).toBe(true);
    expect(commandEvidence(result)[1].success).toBe(true);
    expect(commandEvidence(result)[1].input.timedOut).toBeUndefined();
  });

  it("skips remaining steps with a setup-budget message when the deadline has passed", async () => {
    const { ctx, calls } = fakeSandbox();
    const result = await executeRunbook(
      ctx,
      plan([
        step("install", "npm install"),
        step("setup", "npm run build"),
        step("start", "npm start"),
      ]),
      REPO,
      { deadlineEpochMs: Date.now() - 1 }
    );

    expect(calls).toHaveLength(0);
    const entries = commandEvidence(result);
    expect(entries).toHaveLength(1);
    expect(entries[0].input.skipped).toBe(true);
    expect(entries[0].success).toBe(false);
    expect(entries[0].input.timedOut).toBeUndefined();
    expect(String(entries[0].error)).toMatch(/setup budget/i);
    expect(String(entries[0].error)).toMatch(/not output from the project/i);
  });

  it("skips later steps once an earlier step spends the setup budget", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const { ctx, calls } = fakeSandbox({
      delayIf: (cmd) => (cmd.includes("npm install") ? 80 : 0),
    });
    const pending = executeRunbook(
      ctx,
      plan([
        step("install", "npm install"),
        step("setup", "npm run build"),
      ]),
      REPO,
      { deadlineEpochMs: now + 50 }
    );
    await vi.advanceTimersByTimeAsync(80);
    const result = await pending;

    expect(calls.some((c) => c.cmd.includes("npm run build"))).toBe(false);
    const entries = commandEvidence(result);
    expect(entries).toHaveLength(2);
    expect(entries[0].success).toBe(true);
    expect(entries[1].input.skipped).toBe(true);
    expect(String(entries[1].error)).toMatch(/setup budget/i);
  });

  it("passes the remaining budget through as the step timeout", async () => {
    const { ctx, calls } = fakeSandbox();
    await executeRunbook(
      ctx,
      plan([step("install", "npm install")]),
      REPO,
      { deadlineEpochMs: Date.now() + 12_000 }
    );
    expect(calls[0]?.timeoutMs).toBeGreaterThanOrEqual(MIN_STEP_TIMEOUT_MS);
    expect(calls[0]?.timeoutMs).toBeLessThanOrEqual(12_000);
  });
});

describe("in-flight grading claim/release", () => {
  const ids: string[] = [];

  afterEach(() => {
    for (const id of ids) releaseBehavioralGradingRun(id);
    ids.length = 0;
  });

  it("lets the first claim through and rejects a second until release", () => {
    const id = "sub-claim-a";
    ids.push(id);
    expect(claimBehavioralGradingRun(id)).toBe(true);
    expect(isBehavioralGradingInFlight(id)).toBe(true);
    expect(claimBehavioralGradingRun(id)).toBe(false);
    releaseBehavioralGradingRun(id);
    expect(isBehavioralGradingInFlight(id)).toBe(false);
    expect(claimBehavioralGradingRun(id)).toBe(true);
  });

  it("does not collide across different submission ids", () => {
    const a = "sub-claim-x";
    const b = "sub-claim-y";
    ids.push(a, b);
    expect(claimBehavioralGradingRun(a)).toBe(true);
    expect(claimBehavioralGradingRun(b)).toBe(true);
    expect(isBehavioralGradingInFlight(a)).toBe(true);
    expect(isBehavioralGradingInFlight(b)).toBe(true);
    expect(claimBehavioralGradingRun(a)).toBe(false);
    releaseBehavioralGradingRun(a);
    expect(isBehavioralGradingInFlight(a)).toBe(false);
    expect(isBehavioralGradingInFlight(b)).toBe(true);
  });

  it("is a no-op to release an id that was never claimed", () => {
    expect(() => releaseBehavioralGradingRun("never-claimed")).not.toThrow();
    expect(isBehavioralGradingInFlight("never-claimed")).toBe(false);
  });
});

describe("sweepInterruptedBehavioralGrading", () => {
  beforeEach(() => {
    updateMany.mockReset();
  });

  it("marks stale pending grades as failed with failureCategory interrupted", async () => {
    updateMany.mockResolvedValue({ modifiedCount: 4 });
    await expect(sweepInterruptedBehavioralGrading()).resolves.toBe(4);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({ behavioralGradingStatus: "pending" });
    expect(update.$set.behavioralGradingStatus).toBe("failed");
    expect(String(update.$set.behavioralGradingError)).toMatch(/server restart/i);
    expect(update.$set.behavioralGradingReport.failureCategory).toBe("interrupted");
    expect(update.$set.behavioralGradingReport.setup.status).toBe("failed");
    expect(String(update.$set.behavioralGradingReport.setup.summary)).toMatch(
      /platform failure/i
    );
    expect(update.$unset).toEqual({ behavioralGradingProgress: "" });
  });

  it("returns 0 when nothing was pending", async () => {
    updateMany.mockResolvedValue({ modifiedCount: 0 });
    await expect(sweepInterruptedBehavioralGrading()).resolves.toBe(0);
  });

  it("returns 0 rather than throwing when Mongo is unavailable", async () => {
    updateMany.mockRejectedValue(new Error("ECONNREFUSED"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sweepInterruptedBehavioralGrading()).resolves.toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("triggerBehavioralGradingInBackground wiring", () => {
  it("claims before starting and always releases in finally", async () => {
    const src = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src/controllers/submission.ts"
      ),
      "utf8"
    );
    const start = src.indexOf("function triggerBehavioralGradingInBackground");
    const end = src.indexOf("\nasync function ensureProctoringTranscriptAndEvaluate");
    const fn = src.slice(start, end === -1 ? undefined : end);
    expect(fn).toMatch(/if \(!claimBehavioralGradingRun\(submissionId\)\)/);
    expect(fn).toMatch(/\.finally\(\(\) => \{\s*releaseBehavioralGradingRun\(submissionId\)/);
    expect(fn.indexOf("claimBehavioralGradingRun")).toBeLessThan(
      fn.indexOf("gradeSubmissionBehavioral")
    );
  });
});
