/**
 * Live progress + run-scoped logs for behavioral grading.
 *
 * Two promises: every `[behavioral]` line for a run is greppable by
 * submission id, and a real E2B run writes the same progress document the
 * recruiter UI already polls — then clears it when the run finishes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findByIdAndUpdate = vi.hoisted(() => vi.fn());

vi.mock("../../src/models/submission.js", () => ({
  default: { findByIdAndUpdate },
}));

import {
  behavioralInfo,
  createBehavioralLogger,
  getBehavioralLogContext,
  withBehavioralLogContext,
} from "../../src/services/behavioralGrading/log.js";
import {
  clearBehavioralProgress,
  createProgressWriter,
  PROGRESS_STEP_THROTTLE_MS,
  queuedBehavioralProgress,
  writeBehavioralProgress,
} from "../../src/services/behavioralGrading/progress.js";

function parseLastLog(lines: string[]): Record<string, unknown> {
  const line = lines.at(-1) ?? "";
  const brace = line.indexOf("{");
  expect(brace).toBeGreaterThanOrEqual(0);
  return JSON.parse(line.slice(brace)) as Record<string, unknown>;
}

describe("createBehavioralLogger", () => {
  const lines: string[] = [];
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  const previousLog = process.env.BEHAVIORAL_GRADING_LOG;

  beforeEach(() => {
    lines.length = 0;
    delete process.env.BEHAVIORAL_GRADING_LOG;
    spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      lines.push(String(msg));
    });
  });

  afterEach(() => {
    spy?.mockRestore();
    if (previousLog === undefined) delete process.env.BEHAVIORAL_GRADING_LOG;
    else process.env.BEHAVIORAL_GRADING_LOG = previousLog;
  });

  it("stamps submissionId from run context onto every behavioralInfo line", () => {
    const log = createBehavioralLogger({
      submissionId: "sub_123",
      source: "manual",
    });
    log.run(() => {
      behavioralInfo("clone_done", { repoPath: "/tmp/x" });
    });
    expect(lines.some((l) => l.includes("[behavioral") && l.includes("clone_done"))).toBe(
      true
    );
    const payload = parseLastLog(lines);
    expect(payload.submissionId).toBe("sub_123");
    expect(payload.source).toBe("manual");
    expect(payload.repoPath).toBe("/tmp/x");
  });

  it("lets explicit detail win over context when the same key is set", () => {
    withBehavioralLogContext({ submissionId: "from-context" }, () => {
      behavioralInfo("run_start", { submissionId: "from-detail" });
    });
    expect(parseLastLog(lines).submissionId).toBe("from-detail");
  });

  it("exposes the active context inside run()", () => {
    const log = createBehavioralLogger({ submissionId: "inside" });
    log.run(() => {
      expect(getBehavioralLogContext()?.submissionId).toBe("inside");
    });
    expect(getBehavioralLogContext()).toBeUndefined();
  });

  it("is silent when BEHAVIORAL_GRADING_LOG=0", () => {
    process.env.BEHAVIORAL_GRADING_LOG = "0";
    behavioralInfo("run_start", { submissionId: "nope" });
    expect(lines).toEqual([]);
  });
});

describe("createProgressWriter", () => {
  beforeEach(() => {
    findByIdAndUpdate.mockReset();
    findByIdAndUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes immediately on a phase change", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 3,
      persist,
      unset: vi.fn(),
    });
    await writer.setPhase("sandbox", "Cloning submission into sandbox");
    expect(persist).toHaveBeenCalledTimes(1);
    const written = persist.mock.calls[0][1];
    expect(written.phase).toBe("sandbox");
    expect(written.phaseLabel).toBe("Cloning submission into sandbox");
    expect(written.checksTotal).toBe(3);
  });

  it("coalesces step updates until the throttle elapses", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    let now = 1_000;
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 1,
      throttleMs: PROGRESS_STEP_THROTTLE_MS,
      now: () => now,
      persist,
      unset: vi.fn(),
    });
    await writer.setPhase("judge", "Checking: notes persist");
    persist.mockClear();

    await writer.setSteps([
      { iteration: 1, tool: "run_command", detail: "curl /notes", status: "running" },
    ]);
    expect(persist).not.toHaveBeenCalled();

    await writer.setSteps([
      { iteration: 1, tool: "run_command", detail: "curl /notes", status: "done" },
    ]);
    expect(persist).not.toHaveBeenCalled();

    now += PROGRESS_STEP_THROTTLE_MS;
    await vi.advanceTimersByTimeAsync(PROGRESS_STEP_THROTTLE_MS);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1].agentSteps[0].status).toBe("done");
  });

  it("flush writes a pending throttled update immediately", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 1,
      persist,
      unset: vi.fn(),
    });
    await writer.setPhase("judge", "Checking");
    persist.mockClear();
    await writer.setSteps([
      { iteration: 1, tool: "read_file", detail: "server.js", status: "done" },
    ]);
    expect(persist).not.toHaveBeenCalled();
    await writer.flush();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("records completed checks with verifiedBy and writes immediately", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 2,
      persist,
      unset: vi.fn(),
    });
    await writer.beginCheck(0, "POST /notes stores the note", "Checking (http)");
    persist.mockClear();
    await writer.addCompletedCheck({
      checkIndex: 0,
      checkText: "POST /notes stores the note",
      verdict: "pass",
      verifiedBy: "http",
    });
    expect(persist).toHaveBeenCalledTimes(1);
    const written = persist.mock.calls[0][1];
    expect(written.completedChecks).toEqual([
      {
        checkIndex: 0,
        checkText: "POST /notes stores the note",
        verdict: "pass",
        verifiedBy: "http",
      },
    ]);
  });

  it("stop cancels a pending throttled write without unsetting", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const unset = vi.fn().mockResolvedValue(undefined);
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 1,
      persist,
      unset,
    });
    await writer.setPhase("judge", "Checking");
    persist.mockClear();
    await writer.setSteps([
      { iteration: 1, tool: "curl", detail: "GET /", status: "running" },
    ]);
    await writer.stop();
    await vi.advanceTimersByTimeAsync(PROGRESS_STEP_THROTTLE_MS);
    expect(persist).not.toHaveBeenCalled();
    expect(unset).not.toHaveBeenCalled();
  });

  it("clear unsets the progress field", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const unset = vi.fn().mockResolvedValue(undefined);
    const writer = createProgressWriter({
      submissionId: "s1",
      checksTotal: 1,
      persist,
      unset,
    });
    await writer.setPhase("sandbox", "Provisioning");
    await writer.clear();
    expect(unset).toHaveBeenCalledWith("s1");
  });
});

describe("queued / persist / clear helpers", () => {
  beforeEach(() => {
    findByIdAndUpdate.mockReset();
    findByIdAndUpdate.mockResolvedValue({});
  });

  it("queuedBehavioralProgress is the waiting-for-slot document", () => {
    const queued = queuedBehavioralProgress(4, "2026-08-13T00:00:00.000Z");
    expect(queued.phase).toBe("sandbox");
    expect(queued.phaseLabel).toMatch(/waiting for a grading slot/i);
    expect(queued.checksTotal).toBe(4);
    expect(queued.agentSteps).toEqual([]);
    expect(queued.completedChecks).toEqual([]);
  });

  it("writeBehavioralProgress sets the field and clearBehavioralProgress unsets it", async () => {
    const progress = queuedBehavioralProgress(1);
    await writeBehavioralProgress("s9", progress);
    expect(findByIdAndUpdate).toHaveBeenCalledWith("s9", {
      $set: { behavioralGradingProgress: progress },
    });
    findByIdAndUpdate.mockClear();
    await clearBehavioralProgress("s9");
    expect(findByIdAndUpdate).toHaveBeenCalledWith("s9", {
      $unset: { behavioralGradingProgress: "" },
    });
  });
});
