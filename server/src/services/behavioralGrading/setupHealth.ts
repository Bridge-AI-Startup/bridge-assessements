import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { bashLc } from "./artifacts.js";
import type { StepEvidence } from "./executor.js";
import { behavioralInfo } from "./log.js";

const DEFAULT_HEALTH_MAX_WAIT_MS = 90_000;
const DEFAULT_HEALTH_POLL_MS = 2_000;
const LOG_TAIL_LINES = 80;

export type RunbookSetupStatus = {
  /** ready = app responded or CLI runbook had no failed steps; degraded = runbook issues but partial; failed = cannot grade runtime */
  status: "ready" | "degraded" | "failed";
  phase: "runbook" | "health_wait" | "complete";
  summary: string;
  failedSteps: Array<{
    purpose: string;
    command: string;
    exitCode?: number;
    stderrSnippet?: string;
  }>;
  healthWait?: {
    attempted: boolean;
    ready: boolean;
    attempts: number;
    elapsedMs: number;
    lastError?: string;
    logTail?: string;
  };
};

function getHealthMaxWaitMs(): number {
  const raw = process.env.BEHAVIORAL_GRADING_HEALTH_WAIT_MS;
  if (!raw?.trim()) return DEFAULT_HEALTH_MAX_WAIT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_HEALTH_MAX_WAIT_MS;
  return Math.min(n, 180_000);
}

function snippet(value: string, max = 400): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function summarizeFailedRunbookSteps(
  evidence: StepEvidence[]
): RunbookSetupStatus["failedSteps"] {
  return evidence
    .filter((e) => e.type === "command" && !e.success)
    .map((e) => {
      if (e.type !== "command") return null;
      const input = e.input as { purpose?: string; command?: string };
      return {
        purpose: String(input.purpose ?? "unknown"),
        command: String(input.command ?? "").slice(0, 200),
        exitCode: e.exitCode,
        stderrSnippet: snippet(e.stderrSnippet || e.error || ""),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

/**
 * Run mutating UI/API checks after read-only checks to reduce cross-check pollution.
 * Preserves original index on each item for stable reporting.
 */
export function orderChecksForIsolation(
  checks: string[]
): Array<{ checkText: string; originalIndex: number }> {
  const mutating =
    /\b(add|create|delete|remove|update|edit|submit|post|save|refresh|register|sign\s*up|log\s*in|logout)\b/i;
  const indexed = checks.map((checkText, originalIndex) => ({
    checkText,
    originalIndex,
    isMutating: mutating.test(checkText),
  }));
  indexed.sort((a, b) => {
    if (a.isMutating !== b.isMutating) return a.isMutating ? 1 : -1;
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ checkText, originalIndex }) => ({
    checkText,
    originalIndex,
  }));
}

async function tailStartLog(
  ctx: GradingSandboxContext
): Promise<string | undefined> {
  try {
    const r = await ctx.run(
      bashLc(
        `test -f /tmp/behavioral-app.log && tail -n ${LOG_TAIL_LINES} /tmp/behavioral-app.log || echo "(no /tmp/behavioral-app.log)"`
      ),
      { timeoutMs: 15_000 }
    );
    const text = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
    return text.slice(0, 4000) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Poll the exposed sandbox URL until the app responds or timeout.
 * Also tails /tmp/behavioral-app.log on failure for employer debugging.
 */
export async function waitForAppReady(
  ctx: GradingSandboxContext,
  baseUrl: string,
  evidence: StepEvidence[]
): Promise<RunbookSetupStatus> {
  const failedSteps = summarizeFailedRunbookSteps(evidence);
  const maxWaitMs = getHealthMaxWaitMs();
  const t0 = Date.now();
  let attempts = 0;
  let lastError: string | undefined;
  let ready = false;

  behavioralInfo("health_wait_start", { baseUrl, maxWaitMs });

  while (Date.now() - t0 < maxWaitMs) {
    attempts += 1;
    try {
      const res = await fetch(baseUrl, {
        signal: AbortSignal.timeout(12_000),
        redirect: "follow",
      });
      if (res.status < 500) {
        ready = true;
        lastError = undefined;
        break;
      }
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, DEFAULT_HEALTH_POLL_MS));
  }

  const elapsedMs = Date.now() - t0;
  const logTail = ready ? undefined : await tailStartLog(ctx);

  behavioralInfo("health_wait_done", {
    ready,
    attempts,
    elapsedMs,
    lastError: lastError ?? null,
  });

  const healthWait = {
    attempted: true,
    ready,
    attempts,
    elapsedMs,
    lastError,
    logTail,
  };

  if (ready && failedSteps.length === 0) {
    return {
      status: "ready",
      phase: "complete",
      summary: `App responded at ${baseUrl} after ${attempts} attempt(s) (${Math.round(elapsedMs / 1000)}s).`,
      failedSteps,
      healthWait,
    };
  }

  if (ready && failedSteps.length > 0) {
    const first = failedSteps[0];
    return {
      status: "degraded",
      phase: "complete",
      summary: `App is reachable at ${baseUrl}, but ${failedSteps.length} runbook step(s) failed (first: [${first.purpose}] exit ${first.exitCode ?? "?"}). Behavioral checks may still run with partial setup.`,
      failedSteps,
      healthWait,
    };
  }

  if (!ready && failedSteps.length > 0) {
    const first = failedSteps[0];
    const logHint = logTail
      ? ` Start log tail:\n${logTail.slice(0, 800)}`
      : "";
    return {
      status: "failed",
      phase: "health_wait",
      summary: `Runbook failed and app never became reachable at ${baseUrl}. First failed step: [${first.purpose}] "${first.command.slice(0, 80)}" (exit ${first.exitCode ?? "?"}).${logHint}`,
      failedSteps,
      healthWait,
    };
  }

  return {
    status: "failed",
    phase: "health_wait",
    summary: `App did not respond at ${baseUrl} within ${Math.round(maxWaitMs / 1000)}s (${attempts} attempts).${logTail ? ` Start log:\n${logTail.slice(0, 800)}` : ""}`,
    failedSteps,
    healthWait,
  };
}

/** CLI-only repos: no HTTP health wait; status derives from runbook step outcomes. */
export function buildCliSetupStatus(
  evidence: StepEvidence[]
): RunbookSetupStatus {
  const failedSteps = summarizeFailedRunbookSteps(evidence);
  if (failedSteps.length === 0) {
    return {
      status: "ready",
      phase: "complete",
      summary: "Runbook completed with no failed shell steps (CLI profile).",
      failedSteps,
    };
  }
  const first = failedSteps[0];
  const commands = evidence.filter((e) => e.type === "command");
  const anySuccess = commands.some((e) => e.type === "command" && e.success);
  return {
    status: anySuccess ? "degraded" : "failed",
    phase: "runbook",
    summary: `${failedSteps.length} runbook step(s) failed. First: [${first.purpose}] "${first.command.slice(0, 80)}" (exit ${first.exitCode ?? "?"}).`,
    failedSteps,
  };
}

export type GradingFailureCategory =
  | "setup"
  | "judge"
  | "timeout"
  | "disabled"
  | "unknown";

export function inferFailureCategory(message: string): GradingFailureCategory {
  const m = message.toLowerCase();
  if (m.includes("disabled") || m.includes("not set")) return "disabled";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (
    m.includes("runbook") ||
    m.includes("clone") ||
    m.includes("extract") ||
    m.includes("readme") ||
    m.includes("no behavioral checks")
  ) {
    return "setup";
  }
  return "unknown";
}
