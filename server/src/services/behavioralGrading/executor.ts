import { randomUUID } from "crypto";
import path from "path";
import type { Sandbox } from "e2b";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { getGradingEvidenceStorage } from "../gradingEvidence/storage.js";
import type { RunbookPlan, RunbookStep } from "./schema.js";
import type { AgentToolTraceEntry } from "./agentJudge.js";
import { behavioralInfo } from "./log.js";

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
      verdict: "pass" | "fail" | "inconclusive";
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
  passed: boolean
): string {
  if (passed) {
    return "Passed: the README explicitly lists install, test, and start commands, and the runbook did not rely on inferred commands (all steps are marked as coming from the README).";
  }
  const parts: string[] = [];
  if (!readmeCoverage.hasInstallCommand) {
    parts.push("the planner did not find a clear install command in the README");
  }
  if (!readmeCoverage.hasTestCommand) {
    parts.push("the planner did not find a clear test command in the README");
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

export type RunbookExecutionResult = {
  evidence: StepEvidence[];
  startCommand?: RunbookStep;
  baseUrl?: string;
  readmeRequirementPassed: boolean;
  readmeRequirementDetail: ReadmeRequirementDetail;
};

/**
 * Per runbook step when the planner omits timeoutMs.
 * **0** = no E2B command deadline (see graderSandbox); `npm install` / `npm ci` often exceed 90s.
 * Set a positive step.timeoutMs in the runbook to cap a specific step.
 */
const RUNBOOK_STEP_TIMEOUT_FALLBACK_MS = 0;

function bashLc(cmd: string): string {
  const escaped = cmd.replace(/'/g, "'\\''");
  return `bash -lc '${escaped}'`;
}

function snippet(value: string, max = 1600): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max)}...`;
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
  repoPath: string
): Promise<RunbookExecutionResult> {
  const evidence: StepEvidence[] = [];
  let startCommand: RunbookStep | undefined;
  const inferredCount = runbook.steps.filter((s) => s.origin === "inferred").length;

  for (let si = 0; si < runbook.steps.length; si += 1) {
    const step = runbook.steps[si];
    const startedAt = new Date().toISOString();
    const tStep = Date.now();
    // Long-running dev servers (npm start, uvicorn, …) must fully detach or E2B's
    // commands.run can wait forever. `&` alone is not always enough for npm/node.
    const inner =
      step.purpose === "start"
        ? `nohup bash -c ${JSON.stringify(step.command)} >> /tmp/behavioral-app.log 2>&1 </dev/null &`
        : step.command;
    const cwd = await resolveRunbookWorkingDirectory(ctx, step.cwd, repoPath);
    behavioralInfo("runbook_step_start", {
      stepIndex: si + 1,
      stepTotal: runbook.steps.length,
      purpose: step.purpose,
      origin: step.origin,
      cwd,
      commandPreview: step.command.slice(0, 200),
    });
    const result = await ctx.run(bashLc(inner), {
      cwd,
      timeoutMs: step.timeoutMs ?? RUNBOOK_STEP_TIMEOUT_FALLBACK_MS,
    });
    behavioralInfo("runbook_step_done", {
      stepIndex: si + 1,
      purpose: step.purpose,
      exitCode: result.exitCode,
      ms: Date.now() - tStep,
    });
    const finishedAt = new Date().toISOString();

    evidence.push({
      id: randomUUID(),
      type: "command",
      input: {
        purpose: step.purpose,
        origin: step.origin,
        command: step.command,
      },
      startedAt,
      finishedAt,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdoutSnippet: snippet(result.stdout || ""),
      stderrSnippet: snippet(result.stderr || ""),
      error: result.error,
    });

    if (step.purpose === "start" && result.exitCode === 0) {
      startCommand = step;
    }
  }

  let baseUrl: string | undefined;
  if (startCommand && runbook.portsHint.length > 0) {
    baseUrl = `https://${ctx.sandbox.getHost(runbook.portsHint[0])}`;
  }

  const readmeCoverage = runbook.readmeCoverage;
  const hasRequiredCoverage =
    readmeCoverage.hasInstallCommand &&
    readmeCoverage.hasTestCommand &&
    readmeCoverage.hasStartCommand;

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
      passed
    ),
    notes: readmeCoverage.notes?.trim() || undefined,
  };

  return {
    evidence,
    startCommand,
    baseUrl,
    readmeRequirementPassed: passed,
    readmeRequirementDetail,
  };
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
