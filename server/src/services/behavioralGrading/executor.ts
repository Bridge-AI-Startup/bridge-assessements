import { randomUUID } from "crypto";
import path from "path";
import type { Sandbox } from "e2b";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { getGradingEvidenceStorage } from "../gradingEvidence/storage.js";
import type { RunbookPlan, RunbookStep } from "./schema.js";
import type { AgentToolTraceEntry } from "./agentJudge.js";
import { behavioralInfo } from "./log.js";
import type { RuntimeEnvVar } from "../runtimeSetup/schema.js";
import {
  redactSecrets,
  secretValuesFromEnvVars,
} from "../runtimeSetup/secrets.js";

export type StepEvidence =
  | {
      id: string;
      type: "command" | "http" | "ui";
      input: Record<string, unknown>;
      startedAt: string;
      finishedAt: string;
      success: boolean;
      exitCode?: number;
      stdoutSnippet?: string;
      stderrSnippet?: string;
      http?: {
        status: number;
        bodySnippet: string;
      };
      error?: string;
      artifactKeys?: string[];
    }
  | {
      id: string;
      type: "judge";
      input: Record<string, unknown>;
      startedAt: string;
      finishedAt: string;
      success: boolean;
      verdict: "pass" | "fail" | "inconclusive" | "blocked";
      rationale: string;
      citations: string[];
      agentTrace?: AgentToolTraceEntry[];
    };

export type ReadmeRequirementDetail = {
  passed: boolean;
  inferredStepCount: number;
  hasInstallCommand: boolean;
  hasTestCommand: boolean;
  hasStartCommand: boolean;
  /** Short explanation for employers (why pass / why fail). */
  summary: string;
  /** Optional notes from the README→runbook planner. */
  notes?: string;
};

function buildReadmeRequirementSummary(
  readmeCoverage: RunbookPlan["readmeCoverage"],
  inferredCount: number,
  passed: boolean,
  source: RunbookSource
): string {
  if (source === "candidate_config") {
    return passed
      ? "Passed: the candidate finalized and verified install and start commands during runtime setup; grading reused them verbatim."
      : "Not applicable: commands came from the candidate's verified runtime setup, so the README was not used to plan the run.";
  }
  if (passed) {
    return "Passed: the README explicitly lists install and start commands, and the runbook did not rely on inferred commands (all steps are marked as coming from the README).";
  }
  const parts: string[] = [];
  if (!readmeCoverage.hasInstallCommand) {
    parts.push("the planner did not find a clear install command in the README");
  }
  if (!readmeCoverage.hasStartCommand) {
    parts.push(
      "the planner did not find a clear start/run command in the README"
    );
  }
  if (inferredCount > 0) {
    parts.push(
      `${inferredCount} runbook step(s) were inferred (not taken verbatim from README text); we require commands to be stated in the README`
    );
  }
  if (parts.length === 0) {
    parts.push("README coverage flags did not all pass");
  }
  return `Failed: ${parts.join("; ")}.`;
}

/**
 * The start command exactly as it was run, after path rewrites and env sourcing.
 *
 * Kept so the app can be restarted later (a `restart_persistence` check has to)
 * without re-deriving anything: replaying the literal command that worked is the
 * only restart that is guaranteed to be the same app coming back up.
 */
export type StartExecution = {
  command: string;
  cwd: string;
  usesEnvFile: boolean;
};

export type RunbookExecutionResult = {
  evidence: StepEvidence[];
  startCommand?: RunbookStep;
  startExecution?: StartExecution;
  baseUrl?: string;
  readmeRequirementPassed: boolean;
  readmeRequirementDetail: ReadmeRequirementDetail;
};

/** Where the runbook's commands came from. */
export type RunbookSource = "candidate_config" | "llm";

export type RunbookStepEvent = {
  purpose: RunbookStep["purpose"];
  command: string;
  stepIndex: number;
  stepTotal: number;
  status: "running" | "done" | "skipped";
  timedOut?: boolean;
  exitCode?: number;
};

export type RunbookExecutionOptions = {
  /** Applied to every step, so the app starts the way it did for the candidate. */
  envVars?: RuntimeEnvVar[];
  source?: RunbookSource;
  /**
   * Absolute epoch ms by which setup must be done. Steps are capped by whatever
   * is left, and once it passes the remaining steps are recorded as skipped —
   * the checks still need sandbox time, so setup cannot be allowed to spend all
   * of it.
   */
  deadlineEpochMs?: number;
  /** Live progress / UI — must not throw; callers swallow. */
  onStep?: (event: RunbookStepEvent) => void | Promise<void>;
};

const ENV_FILE = "/tmp/behavioral-grading.env";
const APP_LOG = "/tmp/behavioral-app.log";

/**
 * Per-step deadlines, by what the step is for.
 *
 * These used to be `0` — no deadline at all — which meant one hung `npm install`
 * silently ate the whole sandbox lifetime and the run was then reported as
 * `setup: failed`, indistinguishable from a project that genuinely does not
 * build. A candidate cannot be marked down for our missing timeout, so every
 * step now has a real one and a step that exceeds it is recorded as that step
 * timing out.
 *
 * `start` is generous but finite: the command is detached with `nohup`, so it
 * returns immediately; anything slower is the shell wedging, not the server
 * booting (readiness is the separate health wait).
 */
export const RUNBOOK_STEP_TIMEOUT_MS: Record<RunbookStep["purpose"], number> = {
  install: 10 * 60 * 1000,
  setup: 8 * 60 * 1000,
  test: 6 * 60 * 1000,
  start: 90 * 1000,
};

/** Ceiling on a planner-supplied timeout, so one step cannot claim the whole box. */
export const MAX_STEP_TIMEOUT_MS = 15 * 60 * 1000;

/** Floor when the remaining setup budget is smaller than the step default. */
export const MIN_STEP_TIMEOUT_MS = 5_000;

/** Exit code shells use for "killed by timeout"; keeps evidence readable. */
const TIMEOUT_EXIT_CODE = 124;

export function stepTimeoutMs(step: RunbookStep, msLeft?: number): number {
  const requested = step.timeoutMs && step.timeoutMs > 0 ? step.timeoutMs : undefined;
  const base = Math.min(
    requested ?? RUNBOOK_STEP_TIMEOUT_MS[step.purpose],
    MAX_STEP_TIMEOUT_MS
  );
  // Never promise a step more time than the run has left.
  if (msLeft != null && msLeft > 0) {
    return Math.max(MIN_STEP_TIMEOUT_MS, Math.min(base, msLeft));
  }
  return base;
}

function bashLc(cmd: string): string {
  const escaped = cmd.replace(/'/g, "'\\''");
  return `bash -lc '${escaped}'`;
}

type StepRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
};

/**
 * Runs one runbook command under a hard deadline.
 *
 * E2B signals an exceeded `timeoutMs` inconsistently — sometimes a killed
 * command (non-zero exit), sometimes a thrown deadline error from the gRPC
 * stream — so both are normalized into one result flagged `timedOut`. Nothing
 * about the timeout may escape as an exception: a step hitting its limit is a
 * finding to record, not a crash that discards the evidence collected so far.
 */
async function runStepWithDeadline(
  ctx: GradingSandboxContext,
  command: string,
  opts: { cwd: string; timeoutMs: number }
): Promise<StepRunResult> {
  const startedMs = Date.now();
  try {
    const result = await ctx.run(command, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      // The API stream must outlive the command, or a long step dies of the
      // wrong deadline and reports as a transport error.
      requestTimeoutMs: opts.timeoutMs + 60_000,
    });
    const timedOut =
      result.exitCode !== 0 && Date.now() - startedMs >= opts.timeoutMs - 1_000;
    return {
      exitCode: result.exitCode,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      error: result.error,
      timedOut,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const elapsed = Date.now() - startedMs;
    const looksLikeTimeout =
      /timeout|timed out|deadline/i.test(message) ||
      elapsed >= opts.timeoutMs - 1_000;
    return {
      exitCode: looksLikeTimeout ? TIMEOUT_EXIT_CODE : 1,
      stdout: "",
      stderr: "",
      error: message,
      timedOut: looksLikeTimeout,
    };
  }
}

function timeoutNote(purpose: RunbookStep["purpose"], timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  const readable =
    seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
  return `The ${purpose} step was still running after ${readable} and was stopped. This is a time limit on the grading run, not output from the project.`;
}

function snippet(value: string, max = 1600): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function writeGradingEnvFile(
  ctx: GradingSandboxContext,
  envVars: RuntimeEnvVar[]
): Promise<void> {
  const body = `${envVars
    .filter((row) => row.key)
    .map((row) => `${row.key}=${shellQuote(row.value ?? "")}`)
    .join("\n")}\n`;
  await ctx.sandbox.files.write(ENV_FILE, body);
}

/** Sourced per step; `set -a` exports the assignments to the command's children. */
function withEnvFile(cmd: string): string {
  return `set -a; [ -f ${ENV_FILE} ] && . ${ENV_FILE}; set +a; ${cmd}`;
}

/**
 * Frees the ports a previous runbook attempt bound and clears its app log, so a
 * fallback attempt does not fight the first attempt's server for the port.
 */
export async function stopRunbookApps(
  ctx: GradingSandboxContext,
  ports: number[]
): Promise<void> {
  const unique = Array.from(
    new Set(ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))
  );
  for (const port of unique) {
    await ctx.run(
      bashLc(
        `(command -v fuser >/dev/null 2>&1 && fuser -k -n tcp ${port} >/dev/null 2>&1) || (command -v lsof >/dev/null 2>&1 && kill -9 $(lsof -t -i:${port}) >/dev/null 2>&1) || true`
      ),
      { cwd: "/", timeoutMs: 15_000 }
    );
  }
  await ctx.run(bashLc(`: > ${APP_LOG} 2>/dev/null || true`), {
    cwd: "/",
    timeoutMs: 8_000,
  });
}

async function sandboxDirExists(
  ctx: GradingSandboxContext,
  absDir: string
): Promise<boolean> {
  const r = await ctx.run(
    bashLc(`test -d ${JSON.stringify(absDir)} && echo __ok__`),
    { cwd: "/", timeoutMs: 10_000 }
  );
  return r.exitCode === 0 && (r.stdout || "").includes("__ok__");
}

/**
 * READMEs often assume an extra parent folder (e.g. they unzip to `my-app/` and run
 * `cd my-app/server`). Our sandbox `repoPath` is already that app root. When the first
 * path segment is not a real directory under `repoPath` but the rest of the path is,
 * strip that redundant wrapper segment (repeat for nested wrappers). Works for any name,
 * not only `assessment`.
 */
async function stripRedundantReadmeWrapperPath(
  ctx: GradingSandboxContext,
  repoPath: string,
  rel: string
): Promise<string> {
  const normalizedRepo = path.posix.normalize(repoPath);
  let t = rel.trim().replace(/^\.\//, "");
  if (!t || t === ".") return t;
  t = path.posix.normalize(t);
  if (t.startsWith("..") || path.posix.isAbsolute(t)) {
    return rel.trim();
  }

  let parts = t.split("/").filter(Boolean);

  while (parts.length >= 2) {
    const first = parts[0];
    const rest = parts.slice(1).join("/");
    const firstAbs = path.posix.join(normalizedRepo, first);
    const restAbs = path.posix.join(normalizedRepo, rest);
    const firstExists = await sandboxDirExists(ctx, firstAbs);
    const restExists = await sandboxDirExists(ctx, restAbs);
    if (!firstExists && restExists) {
      parts = rest.split("/").filter(Boolean);
      continue;
    }
    break;
  }

  if (parts.length === 1) {
    const only = parts[0];
    const onlyAbs = path.posix.join(normalizedRepo, only);
    if (!(await sandboxDirExists(ctx, onlyAbs))) {
      return ".";
    }
  }

  return parts.join("/");
}

async function normalizeReadmeRelativePathCached(
  ctx: GradingSandboxContext,
  repoPath: string,
  rel: string,
  cache: Map<string, string>
): Promise<string> {
  const key = rel.trim().replace(/^\.\//, "");
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const v = await stripRedundantReadmeWrapperPath(ctx, repoPath, key);
  cache.set(key, v);
  return v;
}

/**
 * Normalize the first `cd <rel>` in a command when `rel` uses a redundant wrapper folder.
 */
async function normalizeReadmeCommandLeadingCd(
  ctx: GradingSandboxContext,
  repoPath: string,
  cmd: string,
  cache: Map<string, string>
): Promise<string> {
  const m = cmd.match(/^\s*cd\s+([^\s;&|'"]+)/);
  if (!m) return cmd;
  const captured = m[1];
  if (captured.startsWith("/") || captured.startsWith("$")) return cmd;

  const n = await normalizeReadmeRelativePathCached(
    ctx,
    repoPath,
    captured,
    cache
  );
  if (n === captured) return cmd;

  return cmd.replace(/^\s*cd\s+([^\s;&|'"]+)/, () =>
    n === "." ? "cd ." : `cd ${n}`
  );
}

/**
 * From repo root, `cd ../sibling` escapes the project; README often meant `cd sibling`
 * when the nested path was wrong.
 */
async function fixCdDotDotSiblingFromRepoRoot(
  ctx: GradingSandboxContext,
  cmd: string,
  cwd: string,
  repoPath: string
): Promise<string> {
  const normalizedRepo = path.posix.normalize(repoPath);
  if (cwd !== normalizedRepo) return cmd;
  const m = cmd.match(/^\s*cd\s+\.\.\/([^/\s;&|]+)(?=\s|;|&&|$)/);
  if (!m) return cmd;
  const sub = m[1];
  const target = path.posix.join(normalizedRepo, sub);
  if (await sandboxDirExists(ctx, target)) {
    return cmd.replace(/^\s*cd\s+\.\.\/([^/\s;&|]+)/, `cd $1`);
  }
  return cmd;
}

function resolveSafeCwd(rawCwd: string | undefined, repoPath: string): string {
  const normalizedRepo = path.posix.normalize(repoPath);
  if (!rawCwd || !rawCwd.trim()) {
    return normalizedRepo;
  }

  const trimmed = rawCwd.trim();
  const placeholderPatterns = [
    /\/path\/to\/repo/i,
    /^<.*repo.*>$/i,
    /^\{?repo\}?$/i,
    /^repo$/i,
    /your[-_ ]?repo/i,
  ];
  if (placeholderPatterns.some((pattern) => pattern.test(trimmed))) {
    return normalizedRepo;
  }

  const candidate = trimmed.startsWith("/")
    ? trimmed
    : path.posix.join(normalizedRepo, trimmed);
  const normalizedCandidate = path.posix.normalize(candidate);

  if (
    normalizedCandidate === normalizedRepo ||
    normalizedCandidate.startsWith(`${normalizedRepo}/`)
  ) {
    return normalizedCandidate;
  }

  return normalizedRepo;
}

/**
 * README/runbook may name a subfolder (e.g. backend/) that does not exist in the clone
 * (typo, renamed folder, wrong monorepo path). E2B rejects non-existent `cwd`; fall back to repo root.
 */
async function resolveRunbookWorkingDirectory(
  ctx: GradingSandboxContext,
  rawCwd: string | undefined,
  repoPath: string
): Promise<string> {
  const normalizedRepo = path.posix.normalize(repoPath);
  const candidate = resolveSafeCwd(rawCwd, repoPath);
  if (candidate === normalizedRepo) {
    return candidate;
  }
  const probe = await ctx.run(
    bashLc(`test -d ${JSON.stringify(candidate)} && echo __cwd_ok__`),
    { cwd: normalizedRepo, timeoutMs: 10_000 }
  );
  const exists =
    probe.exitCode === 0 && (probe.stdout || "").includes("__cwd_ok__");
  if (exists) {
    return candidate;
  }
  console.warn(
    `[behavioral grading] Runbook cwd missing; using repo root. Requested: ${candidate}`
  );
  return normalizedRepo;
}

export async function executeRunbook(
  ctx: GradingSandboxContext,
  runbook: RunbookPlan,
  repoPath: string,
  options: RunbookExecutionOptions = {}
): Promise<RunbookExecutionResult> {
  const evidence: StepEvidence[] = [];
  let startCommand: RunbookStep | undefined;
  let startExecution: StartExecution | undefined;
  const inferredCount = runbook.steps.filter((s) => s.origin === "inferred").length;
  const source: RunbookSource = options.source ?? "llm";
  const envVars = (options.envVars || []).filter((row) => row.key);
  const secrets = secretValuesFromEnvVars(envVars);
  const scrub = (text: string) =>
    secrets.length ? redactSecrets(text, secrets) : text;
  const notifyStep = async (event: RunbookStepEvent) => {
    try {
      await options.onStep?.(event);
    } catch {
      // Live progress must never fail the runbook.
    }
  };
  if (envVars.length > 0) {
    await writeGradingEnvFile(ctx, envVars);
    behavioralInfo("runbook_env_applied", {
      keys: envVars.map((row) => row.key),
      secretCount: secrets.length,
    });
  }

  const readmePathCache = new Map<string, string>();

  const runnableSteps = runbook.steps.filter((s) => s.purpose !== "test");
  const skippedTestCount = runbook.steps.length - runnableSteps.length;
  if (skippedTestCount > 0) {
    behavioralInfo("runbook_skip_test_steps", { skippedTestCount });
  }

  const runDeadlineMs = options.deadlineEpochMs;

  for (let si = 0; si < runnableSteps.length; si += 1) {
    const step = runnableSteps[si];
    const startedAt = new Date().toISOString();
    const tStep = Date.now();

    if (runDeadlineMs && Date.now() >= runDeadlineMs) {
      behavioralInfo("runbook_budget_exhausted", {
        stepIndex: si + 1,
        remainingSteps: runnableSteps.length - si,
      });
      await notifyStep({
        purpose: step.purpose,
        command: step.command,
        stepIndex: si + 1,
        stepTotal: runnableSteps.length,
        status: "skipped",
      });
      evidence.push({
        id: randomUUID(),
        type: "command",
        input: {
          purpose: step.purpose,
          origin: step.origin,
          command: step.command,
          skipped: true,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        error:
          "Skipped: the setup budget for this grading run was already spent by earlier steps. This is a limit on the grading run, not output from the project.",
      });
      break;
    }

    let cwdForStep: string | undefined = step.cwd;
    const rawCwd = cwdForStep?.trim();
    if (rawCwd && !rawCwd.startsWith("/")) {
      const n = await normalizeReadmeRelativePathCached(
        ctx,
        repoPath,
        rawCwd,
        readmePathCache
      );
      cwdForStep = n === "." || n === "" ? undefined : n;
    }

    let commandForStep = await normalizeReadmeCommandLeadingCd(
      ctx,
      repoPath,
      step.command,
      readmePathCache
    );

    let cwd = await resolveRunbookWorkingDirectory(ctx, cwdForStep, repoPath);
    commandForStep = await fixCdDotDotSiblingFromRepoRoot(
      ctx,
      commandForStep,
      cwd,
      repoPath
    );

    // Long-running dev servers (npm start, uvicorn, …) must fully detach or E2B's
    // commands.run can wait forever. `&` alone is not always enough for npm/node.
    const withEnv =
      envVars.length > 0 ? withEnvFile(commandForStep) : commandForStep;
    const inner =
      step.purpose === "start"
        ? `nohup bash -c ${JSON.stringify(withEnv)} >> ${APP_LOG} 2>&1 </dev/null &`
        : withEnv;
    const msLeft = runDeadlineMs ? runDeadlineMs - Date.now() : undefined;
    const timeoutForStep = stepTimeoutMs(step, msLeft);
    behavioralInfo("runbook_step_start", {
      stepIndex: si + 1,
      stepTotal: runnableSteps.length,
      purpose: step.purpose,
      origin: step.origin,
      cwd,
      timeoutMs: timeoutForStep,
      commandPreview: commandForStep.slice(0, 200),
    });
    await notifyStep({
      purpose: step.purpose,
      command: commandForStep,
      stepIndex: si + 1,
      stepTotal: runnableSteps.length,
      status: "running",
    });
    const result = await runStepWithDeadline(ctx, bashLc(inner), {
      cwd,
      timeoutMs: timeoutForStep,
    });
    behavioralInfo("runbook_step_done", {
      stepIndex: si + 1,
      purpose: step.purpose,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ms: Date.now() - tStep,
    });
    await notifyStep({
      purpose: step.purpose,
      command: commandForStep,
      stepIndex: si + 1,
      stepTotal: runnableSteps.length,
      status: "done",
      timedOut: result.timedOut,
      exitCode: result.exitCode,
    });
    const finishedAt = new Date().toISOString();

    const stepError = result.timedOut
      ? timeoutNote(step.purpose, timeoutForStep)
      : result.error;
    evidence.push({
      id: randomUUID(),
      type: "command",
      input: {
        purpose: step.purpose,
        origin: step.origin,
        command: step.command,
        timeoutMs: timeoutForStep,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(commandForStep !== step.command ? { executedCommand: commandForStep } : {}),
      },
      startedAt,
      finishedAt,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdoutSnippet: snippet(scrub(result.stdout)),
      stderrSnippet: snippet(scrub(result.stderr)),
      error: stepError ? scrub(stepError) : undefined,
    });

    // A timed-out install or build leaves the tree half-populated; the steps
    // after it would fail for a reason that is no longer the candidate's.
    if (result.timedOut && step.purpose !== "start") {
      behavioralInfo("runbook_abort_after_timeout", {
        stepIndex: si + 1,
        purpose: step.purpose,
        remainingSteps: runnableSteps.length - (si + 1),
      });
      break;
    }

    if (step.purpose === "start" && result.exitCode === 0) {
      startCommand = step;
      startExecution = {
        command: commandForStep,
        cwd,
        usesEnvFile: envVars.length > 0,
      };
    }
  }

  let baseUrl: string | undefined;
  if (startCommand && runbook.portsHint.length > 0) {
    baseUrl = `https://${ctx.sandbox.getHost(runbook.portsHint[0])}`;
  }

  const readmeCoverage = runbook.readmeCoverage;
  const hasRequiredCoverage =
    readmeCoverage.hasInstallCommand && readmeCoverage.hasStartCommand;

  const passed = hasRequiredCoverage && inferredCount === 0;
  const readmeRequirementDetail: ReadmeRequirementDetail = {
    passed,
    inferredStepCount: inferredCount,
    hasInstallCommand: readmeCoverage.hasInstallCommand,
    hasTestCommand: readmeCoverage.hasTestCommand,
    hasStartCommand: readmeCoverage.hasStartCommand,
    summary: buildReadmeRequirementSummary(
      readmeCoverage,
      inferredCount,
      passed,
      source
    ),
    notes: readmeCoverage.notes?.trim() || undefined,
  };

  return {
    evidence,
    startCommand,
    startExecution,
    baseUrl,
    readmeRequirementPassed: passed,
    readmeRequirementDetail,
  };
}

/**
 * Kill whatever holds the app's ports and start it again with the same command.
 *
 * Only a `restart_persistence` check needs this, and it is what makes that check
 * meaningful: an app keeping notes in a module-level array passes a create-then-read
 * sequence and fails here, which is precisely the distinction we could not make
 * before.
 */
export async function restartRunbookApp(
  ctx: GradingSandboxContext,
  startExecution: StartExecution,
  ports: number[]
): Promise<{ ok: boolean; error?: string }> {
  await stopRunbookApps(ctx, ports);
  const withEnv = startExecution.usesEnvFile
    ? withEnvFile(startExecution.command)
    : startExecution.command;
  const result = await ctx.run(
    bashLc(
      `nohup bash -c ${JSON.stringify(withEnv)} >> ${APP_LOG} 2>&1 </dev/null &`
    ),
    { cwd: startExecution.cwd, timeoutMs: 30_000 }
  );
  behavioralInfo("app_restarted", {
    exitCode: result.exitCode,
    cwd: startExecution.cwd,
  });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: snippet(result.stderr || result.error || "restart failed", 400),
    };
  }
  return { ok: true };
}

export async function saveReportJson(
  submissionId: string,
  report: unknown
): Promise<string> {
  const evidenceStorage = getGradingEvidenceStorage();
  const key = `submissions/${submissionId}/report.json`;
  await evidenceStorage.storeText(key, JSON.stringify(report, null, 2));
  return key;
}

export async function readmeFromSandbox(
  sandbox: Sandbox,
  repoPath: string
): Promise<string> {
  const candidates = [
    `${repoPath}/README.md`,
    `${repoPath}/Readme.md`,
    `${repoPath}/readme.md`,
  ];

  for (const filePath of candidates) {
    try {
      const content = await sandbox.files.read(filePath);
      if (typeof content === "string" && content.trim().length > 0) {
        return content;
      }
    } catch {
      // try next candidate
    }
  }

  return "";
}

const REPO_LAYOUT_PROBE_MAX_CHARS = 14_000;

/**
 * Runs `ls` / `find` in the sandbox so the runbook planner can align cwd and `cd` paths
 * with the actual tree (no hardcoded folder names).
 */
export async function probeRepoLayoutForRunbook(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<string> {
  const rp = JSON.stringify(path.posix.normalize(repoPath));
  const inner = [
    `cd ${rp}`,
    `echo "=== pwd ===" && pwd`,
    `echo "=== ls -la (repo root) ===" && ls -la`,
    `echo "=== package.json (depth <= 6) ==="`,
    `find . -maxdepth 6 -type f -name package.json 2>/dev/null | head -100`,
    `echo "=== other project markers ==="`,
    `find . -maxdepth 5 -type f \\( -name pyproject.toml -o -name go.mod -o -name Cargo.toml -o -name pom.xml \\) 2>/dev/null | head -60`,
  ].join(" && ");
  const r = await ctx.run(bashLc(inner), { cwd: "/", timeoutMs: 45_000 });
  const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
  if (!out) {
    return "(layout probe produced no output)";
  }
  if (out.length > REPO_LAYOUT_PROBE_MAX_CHARS) {
    return `${out.slice(0, REPO_LAYOUT_PROBE_MAX_CHARS)}\n… [truncated]`;
  }
  return out;
}
