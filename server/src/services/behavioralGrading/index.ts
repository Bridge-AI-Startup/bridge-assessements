import { randomUUID } from "crypto";
import SubmissionModel from "../../models/submission.js";
import { withGradingSandbox } from "../e2b/graderSandbox.js";
import { collectJudgeArtifacts } from "./artifacts.js";
import { getSubmissionCodeStorage } from "../submissionCode/storage.js";
import {
  executeRunbook,
  probeRepoLayoutForRunbook,
  readmeFromSandbox,
  restartRunbookApp,
  saveReportJson,
  stopRunbookApps,
  type ReadmeRequirementDetail,
  type RunbookExecutionResult,
  type RunbookSource,
  type StepEvidence,
} from "./executor.js";
import {
  captureAriaSnapshot,
  compileCheckSpec,
} from "./compileCheckSpec.js";
import { runDeterministicCheck } from "./deterministicChecks.js";
import {
  deepenUiControlsFromSandbox,
  type UiControl,
} from "./extractUiControls.js";
import {
  extractCapabilitiesFromSandbox,
  type Capability,
} from "./extractCapabilities.js";
import { secretValuesFromEnvVars } from "../runtimeSetup/secrets.js";
import {
  candidateGradingEnv,
  candidateRunbookFromSubmission,
} from "./runtimeConfigRunbook.js";
import type { RunbookPlan } from "./schema.js";
import type { RuntimeEnvVar } from "../runtimeSetup/schema.js";
import { runAgentBehavioralJudge } from "./agentJudge.js";
import { BehavioralBrowserSession } from "./browserSession.js";
import { extractRunbook } from "./planner.js";
import { behavioralInfo, createBehavioralLogger } from "./log.js";
import {
  createProgressWriter,
  type BehavioralProgressStep,
} from "./progress.js";
import {
  buildCliSetupStatus,
  checkRequiresRunningApp,
  orderChecksForIsolation,
  waitForAppReady,
  waitForAppReadyInsideSandbox,
  type GradingFailureCategory,
  type RunbookSetupStatus,
} from "./setupHealth.js";
import { computeBehavioralScore, type BehavioralScore } from "./scoring.js";
import {
  resolveBehavioralCheckSpecs,
  type BehavioralCheckKind,
  type BehavioralCheckSpec,
} from "./checkSpecs.js";
import { discoverSandboxAppAccess } from "./sandboxAppUrl.js";

export type BehavioralCaseResult = {
  checkText: string;
  /** Original index in assessment.behavioralChecks (stable after isolation reorder). */
  checkIndex: number;
  /** Stable spec id — survives reordering, so a recruiter link keeps pointing at the same check. */
  checkId?: string;
  /** How the verdict was reached: a deterministic acceptance run, or the LLM judge. */
  verifiedBy?: BehavioralCheckKind;
  /** `blocked` = never judged because the environment could not support it. */
  verdict: "pass" | "fail" | "inconclusive" | "blocked";
  evidence: StepEvidence[];
  artifacts: string[];
  /** Fresh browser context per check when web grading (G). */
  isolation?: "fresh_browser_context";
};

export type BehavioralGradingReport = {
  sandbox: {
    sandboxId: string;
    timeoutMs: number;
  };
  runbook: {
    summary: string;
    readmeRequirementPassed: boolean;
    readmeRequirementDetail: ReadmeRequirementDetail;
    evidence: StepEvidence[];
    baseUrl?: string;
    /** In-sandbox origin discovered after runbook (e.g. http://127.0.0.1:5070). */
    sandboxAppOrigin?: string;
    sandboxAppDiscovery?: string;
    executionProfile?: "cli_stdout" | "web_server" | "unclear";
  };
  setup: RunbookSetupStatus;
  /** Whether the commands came from the candidate's verified config or the LLM planner. */
  runbookSource: RunbookSource;
  /** Set when the candidate config was tried first and did not reach ready. */
  runbookFallbackReason?: string;
  failureCategory?: GradingFailureCategory | null;
  cases: BehavioralCaseResult[];
  /** Pass rate over decided checks. Single source of truth for every reader. */
  score: BehavioralScore;
  startedAt: string;
  completedAt: string;
  reportArtifactKey?: string;
};

/** E2B sandbox lifetime for one behavioral grading run. Default 30m — 15m was often too short for many checks × LLM agent. Override with BEHAVIORAL_GRADING_SANDBOX_TIMEOUT_MS (ms), max 1h. */
const MIN_SANDBOX_MS = 5 * 60 * 1000;
const MAX_SANDBOX_MS = 60 * 60 * 1000;
const DEFAULT_SANDBOX_MS = 30 * 60 * 1000;

function getBehavioralSandboxTimeoutMs(): number {
  const raw = process.env.BEHAVIORAL_GRADING_SANDBOX_TIMEOUT_MS;
  if (!raw?.trim()) return DEFAULT_SANDBOX_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SANDBOX_MS;
  return Math.min(MAX_SANDBOX_MS, Math.max(MIN_SANDBOX_MS, n));
}

const MAX_CONCURRENT_GRADES = Number(process.env.BEHAVIORAL_GRADING_MAX_CONCURRENT || 2);
let activeGrades = 0;
const gradeQueue: Array<() => void> = [];

/** In-process grading concurrency snapshot for ops dashboard (this Render instance only). */
export function getBehavioralGradingQueueStats(): {
  active: number;
  queued: number;
  maxConcurrent: number;
} {
  return {
    active: activeGrades,
    queued: gradeQueue.length,
    maxConcurrent: MAX_CONCURRENT_GRADES,
  };
}

/** When unset or false, E2B behavioral grading is disabled (auto-submit and manual re-run). Set BEHAVIORAL_GRADING_ENABLED=true to enable. */
export function isBehavioralGradingEnabled(): boolean {
  const raw = process.env.BEHAVIORAL_GRADING_ENABLED;
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

function isUploadBehavioralEnabled(): boolean {
  const raw = process.env.BEHAVIORAL_GRADING_UPLOAD_ENABLED;
  if (!raw) return true;
  return raw === "1" || raw.toLowerCase() === "true";
}

async function withGradeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeGrades >= MAX_CONCURRENT_GRADES) {
    behavioralInfo("grade_slot_wait", {
      activeGrades,
      maxConcurrent: MAX_CONCURRENT_GRADES,
      queued: gradeQueue.length + 1,
    });
    await new Promise<void>((resolve) => gradeQueue.push(resolve));
  }
  activeGrades += 1;
  behavioralInfo("grade_slot_acquired", {
    activeGrades,
    maxConcurrent: MAX_CONCURRENT_GRADES,
  });
  try {
    return await fn();
  } finally {
    activeGrades -= 1;
    const next = gradeQueue.shift();
    if (next) next();
  }
}

/**
 * Submissions this process is currently grading (queued or running).
 *
 * Submit already triggers a run, so a recruiter hitting "Re-run" on a fresh
 * submission used to start a second sandbox against the same code: two runs
 * writing one report field, the loser's verdicts silently overwriting the
 * winner's. In-process is the right scope because the queue above is too.
 */
const inFlightGrades = new Set<string>();

export function isBehavioralGradingInFlight(submissionId: string): boolean {
  return inFlightGrades.has(submissionId);
}

/** True while this process holds any grade (queued or running a sandbox). */
export function hasAnyBehavioralGradingInFlight(): boolean {
  return inFlightGrades.size > 0;
}

/** Reserves the submission for one run; false when a run already holds it. */
export function claimBehavioralGradingRun(submissionId: string): boolean {
  if (inFlightGrades.has(submissionId)) return false;
  inFlightGrades.add(submissionId);
  return true;
}

export function releaseBehavioralGradingRun(submissionId: string): void {
  inFlightGrades.delete(submissionId);
}

/**
 * Marks runs that this process can no longer be holding as interrupted.
 *
 * The queue lives in memory, so every deploy or crash abandons whatever was
 * grading — and a `pending` submission renders as a spinner forever, which
 * looks like a candidate whose grading is still going rather than one whose
 * grading was thrown away. Run once at boot, before any new work is accepted.
 */
export async function sweepInterruptedBehavioralGrading(): Promise<number> {
  try {
    const result = await SubmissionModel.updateMany(
      { behavioralGradingStatus: "pending" },
      {
        $set: {
          behavioralGradingStatus: "failed",
          behavioralGradingError:
            "Code grading was interrupted by a server restart before it finished. Re-run it to get verdicts; nothing here reflects the candidate's work.",
          behavioralGradingReport: {
            failureCategory: "interrupted" satisfies GradingFailureCategory,
            setup: {
              status: "failed",
              phase: "runbook",
              summary:
                "The grading run was interrupted by a server restart. This is a platform failure, not a result for this submission.",
              failedSteps: [],
            },
            cases: [],
          },
        },
        $unset: { behavioralGradingProgress: "" },
      }
    );
    const swept = result.modifiedCount ?? 0;
    if (swept > 0) {
      behavioralInfo("interrupted_sweep", { swept });
    }
    return swept;
  } catch (err) {
    console.error(
      "[behavioral grading] Failed to sweep interrupted runs at boot:",
      err
    );
    return 0;
  }
}

function getRepoSummary(submission: any): string {
  if (submission.codeSource === "upload") {
    const upload = submission.codeUpload || {};
    return [
      "source=upload",
      `storageKey=${upload.storageKey ?? ""}`,
      `filename=${upload.originalFilename ?? ""}`,
      `sha256=${upload.sha256 ?? ""}`,
    ].join("\n");
  }
  const repo = submission.githubRepo || {};
  return [
    "source=github",
    `owner=${repo.owner ?? ""}`,
    `repo=${repo.repo ?? ""}`,
    `refType=${repo.refType ?? ""}`,
    `pinnedCommitSha=${repo.pinnedCommitSha ?? ""}`,
  ].join("\n");
}

function getPublicCloneUrl(submission: any): string {
  const owner = submission.githubRepo?.owner;
  const repo = submission.githubRepo?.repo;
  if (!owner || !repo) {
    throw new Error("Submission does not contain parsed GitHub repo owner/repo.");
  }
  return `https://github.com/${owner}/${repo}.git`;
}

async function cloneAndCheckout(
  run: (
    cmd: string,
    opts?: any
  ) => Promise<{ exitCode: number; stderr: string; stdout?: string }>,
  submission: any,
  sandbox?: any
): Promise<string> {
  const repoPath = `/tmp/submission-${submission._id.toString()}`;
  if (submission.codeSource === "upload") {
    const storageKey = submission.codeUpload?.storageKey;
    if (!storageKey) {
      throw new Error("Submission archive metadata is missing.");
    }
    const archiveStorage = getSubmissionCodeStorage();
    const archive = await archiveStorage.readArchive(storageKey);
    const archivePath = `${repoPath}.zip`;
    await (sandbox as any).files.write(archivePath, archive);

    const ensureRepoDir = await run(`mkdir -p ${repoPath}`, { timeoutMs: 15000 });
    if (ensureRepoDir.exitCode !== 0) {
      throw new Error(
        `Failed to prepare repo directory: ${ensureRepoDir.stderr || "unknown error"}`
      );
    }

    const unzip = await run(`unzip -q ${archivePath} -d ${repoPath}`, {
      timeoutMs: 180000,
    });
    if (unzip.exitCode !== 0) {
      throw new Error(
        `Failed to extract uploaded archive: ${unzip.stderr || "unknown error"}`
      );
    }
    const resolveRoot = await run(
      `bash -lc 'shopt -s nullglob dotglob; entries=(${repoPath}/*); if [ "\${#entries[@]}" -eq 1 ] && [ -d "\${entries[0]}" ]; then printf "%s" "\${entries[0]}"; else printf "%s" "${repoPath}"; fi'`,
      { timeoutMs: 15000 }
    );
    if (resolveRoot.exitCode === 0 && resolveRoot.stdout?.trim()) {
      return resolveRoot.stdout.trim();
    }
    return repoPath;
  }

  const cloneUrl = getPublicCloneUrl(submission);
  const clone = await run(`git clone ${cloneUrl} ${repoPath}`, { timeoutMs: 180000 });
  if (clone.exitCode !== 0) {
    throw new Error(`Failed to clone repository: ${clone.stderr || "unknown error"}`);
  }

  const sha = submission.githubRepo?.pinnedCommitSha;
  if (sha) {
    const checkout = await run(`git checkout ${sha}`, {
      cwd: repoPath,
      timeoutMs: 60000,
    });
    if (checkout.exitCode !== 0) {
      throw new Error(`Failed to checkout pinned commit: ${checkout.stderr || "unknown error"}`);
    }
  }

  return repoPath;
}

function summarizeRunbook(runbook: any): string {
  return runbook.steps
    .map((s: any, idx: number) => `${idx + 1}. [${s.purpose}/${s.origin}] ${s.command}`)
    .join("\n");
}

const ASSESSMENT_DESC_MAX = 8000;

function assessmentDescriptionExcerpt(assessment: any): string {
  const raw = typeof assessment?.description === "string" ? assessment.description : "";
  if (raw.length <= ASSESSMENT_DESC_MAX) return raw;
  return `${raw.slice(0, ASSESSMENT_DESC_MAX)}\n…`;
}

export {
  inferFailureCategory,
  gradingFaultOwner,
  type GradingFailureCategory,
  type RunbookSetupStatus,
} from "./setupHealth.js";

/** A config without an explicit port can still have bound one; free that too. */
function portsFromOrigin(origin: string | undefined): number[] {
  const match = origin?.match(/:(\d{2,5})(?:\/|$)/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isInteger(port) ? [port] : [];
}

function runbookProgressPhase(
  purpose: string
): "install" | "start" {
  return purpose === "start" ? "start" : "install";
}

function previewCommand(command: string, max = 80): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function agentTraceToProgressSteps(
  trace: Array<{
    iteration: number;
    tool: string;
    detail: string;
    outputPreview?: string;
  }>,
  running?: { iteration: number; tool: string; detail: string }
): BehavioralProgressStep[] {
  const steps: BehavioralProgressStep[] = trace.map((t) => ({
    iteration: t.iteration,
    tool: t.tool,
    detail: previewCommand(t.detail, 160),
    status: "done" as const,
    ...(t.outputPreview
      ? { outputPreview: t.outputPreview.slice(0, 240) }
      : {}),
  }));
  if (running) {
    steps.push({
      iteration: running.iteration,
      tool: running.tool,
      detail: previewCommand(running.detail, 160),
      status: "running",
    });
  }
  return steps;
}

async function safeProgress(
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch {
    // Live progress must never fail the grading run.
  }
}

/** One execution of a runbook, from commands through app-ready health. */
type RunbookAttempt = {
  source: RunbookSource;
  runbook: RunbookPlan;
  runbookResult: RunbookExecutionResult;
  executionProfile: "cli_stdout" | "web_server" | "unclear";
  appAccess: Awaited<ReturnType<typeof discoverSandboxAppAccess>>;
  sandboxAppOrigin?: string;
  browserBaseUrl?: string;
  setup: RunbookSetupStatus;
};

export async function gradeSubmissionBehavioral(
  submissionId: string
): Promise<BehavioralGradingReport> {
  const log = createBehavioralLogger({ submissionId });
  return log.runAsync(() =>
    withGradeSlot(async () => {
    const t0 = Date.now();
    if (!isBehavioralGradingEnabled()) {
      throw new Error(
        "Code grading (E2B) is disabled. Set BEHAVIORAL_GRADING_ENABLED=true to enable."
      );
    }
    const submission = await SubmissionModel.findById(submissionId).populate("assessmentId");
    if (!submission) {
      throw new Error("Submission not found");
    }
    if (submission.codeSource === "upload" && !isUploadBehavioralEnabled()) {
      throw new Error(
        "Code grading for uploaded archives is currently disabled."
      );
    }

    const assessment: any = submission.assessmentId;
    // Never read `behavioralChecks` / `behavioralCheckSpecs` directly: the
    // resolver pairs every sentence with a spec (defaulting to the agent judge)
    // and honours the server-wide deterministic switch.
    const resolvedSpecs = resolveBehavioralCheckSpecs(assessment ?? {});
    const specsByIndex: BehavioralCheckSpec[] = resolvedSpecs.specs;
    const behavioralChecks: string[] = specsByIndex.map((s) => s.text);
    if (behavioralChecks.length === 0) {
      throw new Error("Assessment has no product checks configured.");
    }
    if (resolvedSpecs.rejected.length > 0 || resolvedSpecs.orphanedSpecIds.length > 0) {
      behavioralInfo("check_specs_ignored", {
        submissionId,
        rejected: resolvedSpecs.rejected,
        orphaned: resolvedSpecs.orphanedSpecIds,
      });
    }

    const startedAt = new Date().toISOString();
    const sandboxTimeoutMs = getBehavioralSandboxTimeoutMs();
    /**
     * How long one setup attempt (install → build → start) may take. Checks are
     * the point of the run, so setup gets a fixed share of the box rather than
     * however much it feels like using.
     */
    const setupBudgetMs = Math.floor(sandboxTimeoutMs * 0.4);

    behavioralInfo("run_start", {
      submissionId,
      checks: behavioralChecks.length,
      deterministicChecks: specsByIndex.filter((s) => s.kind !== "agent").length,
      sandboxTimeoutMs,
      setupBudgetMs,
    });

    const progress = createProgressWriter({
      submissionId,
      checksTotal: behavioralChecks.length,
      startedAt,
    });
    await safeProgress(() =>
      progress.setPhase("sandbox", "Provisioning E2B sandbox…")
    );

    try {
    const report = await withGradingSandbox<BehavioralGradingReport>(
      async (ctx) => {
        behavioralInfo("sandbox_open", {
          sandboxId: ctx.sandboxId,
          sandboxTimeoutMs,
        });
        await safeProgress(() =>
          progress.setPhase("sandbox", "Cloning submission into sandbox")
        );

        const repoPath = await cloneAndCheckout(ctx.run, submission, ctx.sandbox);
        behavioralInfo("clone_done", { repoPath });

        let uiCatalog: UiControl[] = [];
        let capabilities: Capability[] = [];
        try {
          const extracted = await extractCapabilitiesFromSandbox(ctx, repoPath);
          uiCatalog = extracted.controls;
          capabilities = extracted.capabilities;
        } catch (e) {
          behavioralInfo("ui_catalog_failed", {
            error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
          });
        }

        const readmeText = await readmeFromSandbox(ctx.sandbox, repoPath);
        const repoLayoutProbe = await probeRepoLayoutForRunbook(ctx, repoPath);
        behavioralInfo("repo_layout_probe", {
          chars: repoLayoutProbe.length,
        });
        const repoSummary = getRepoSummary(submission);

        const runAttempt = async (
          runbook: RunbookPlan,
          source: RunbookSource,
          envVars?: RuntimeEnvVar[]
        ): Promise<RunbookAttempt> => {
          const runbookResult = await executeRunbook(ctx, runbook, repoPath, {
            source,
            envVars,
            // Each attempt gets its own slice of the box, so a slow first
            // attempt cannot leave the fallback (or the checks) with no time.
            deadlineEpochMs: Date.now() + setupBudgetMs,
            onStep: (event) =>
              safeProgress(() =>
                progress.setPhase(
                  runbookProgressPhase(event.purpose),
                  event.status === "skipped"
                    ? "Setup budget spent — remaining steps skipped"
                    : event.status === "running"
                      ? `Running ${event.purpose}: ${previewCommand(event.command)}`
                      : event.timedOut
                        ? `${event.purpose} hit the grading time limit`
                        : `Finished ${event.purpose}`,
                  {
                    agentSteps: [
                      {
                        iteration: event.stepIndex,
                        tool: event.purpose,
                        detail: previewCommand(event.command),
                        status:
                          event.status === "running"
                            ? "running"
                            : event.status === "skipped"
                              ? "pending"
                              : "done",
                      },
                    ],
                  }
                )
              ),
          });
          behavioralInfo("runbook_executed", {
            source,
            readmeRequirementPassed: runbookResult.readmeRequirementPassed,
            hasBaseUrl: Boolean(runbookResult.baseUrl),
          });

          const executionProfile = runbook.executionProfile ?? "unclear";
          const appAccess = await discoverSandboxAppAccess(
            ctx,
            repoPath,
            readmeText,
            runbook,
            executionProfile === "cli_stdout" ? undefined : runbookResult.baseUrl
          );
          const sandboxAppOrigin = appAccess.internalOrigin;
          const browserBaseUrl = appAccess.externalOrigin;

          let setup: RunbookSetupStatus;
          if (executionProfile !== "cli_stdout" && sandboxAppOrigin) {
            await safeProgress(() =>
              progress.setPhase("start", "Waiting for the app to respond")
            );
            setup = await waitForAppReadyInsideSandbox(
              ctx,
              sandboxAppOrigin,
              runbookResult.evidence
            );
          } else if (browserBaseUrl?.trim()) {
            await safeProgress(() =>
              progress.setPhase("start", "Waiting for the app to respond")
            );
            setup = await waitForAppReady(
              ctx,
              browserBaseUrl,
              runbookResult.evidence
            );
          } else {
            setup = buildCliSetupStatus(runbookResult.evidence);
          }
          if (setup.status === "failed") {
            behavioralInfo("setup_failed", { source, summary: setup.summary });
          }

          return {
            source,
            runbook,
            runbookResult,
            executionProfile,
            appAccess,
            sandboxAppOrigin,
            browserBaseUrl,
            setup,
          };
        };

        const planFromReadme = async (): Promise<RunbookAttempt> => {
          const runbookRaw = await extractRunbook({
            readmeText,
            repoSummary,
            repoLayoutProbe,
          });
          const runbook = {
            ...runbookRaw,
            steps: runbookRaw.steps.filter((s) => s.purpose !== "test"),
          };
          behavioralInfo("runbook_llm_ok", {
            steps: runbook.steps.length,
            profile: runbook.executionProfile,
          });
          return runAttempt(runbook, "llm");
        };

        const candidate = candidateRunbookFromSubmission(submission as never);
        let attempt: RunbookAttempt;
        let runbookFallbackReason: string | undefined;

        if (candidate) {
          behavioralInfo("runbook_candidate_config", {
            steps: candidate.runbook.steps.length,
            profile: candidate.runbook.executionProfile,
            port: candidate.config.port,
          });
          attempt = await runAttempt(
            candidate.runbook,
            "candidate_config",
            candidateGradingEnv(candidate.config)
          );
          if (attempt.setup.status === "failed") {
            // The candidate verified these commands, so a failure here is more
            // likely an environment difference than a wrong config — plan from
            // the README rather than grading a project that never came up.
            runbookFallbackReason =
              attempt.setup.summary ||
              "Candidate runtime config did not reach a ready state.";
            behavioralInfo("runbook_candidate_config_fallback", {
              reason: runbookFallbackReason,
            });
            await stopRunbookApps(ctx, [
              ...candidate.runbook.portsHint,
              ...portsFromOrigin(attempt.sandboxAppOrigin),
            ]);
            attempt = await planFromReadme();
          }
        } else {
          attempt = await planFromReadme();
        }

        const {
          runbook,
          runbookResult,
          executionProfile,
          appAccess,
          sandboxAppOrigin,
          browserBaseUrl,
          setup,
        } = attempt;
        const runbookSummary = summarizeRunbook(runbook);

        // Candidate secret values never reach recorded evidence.
        const candidateSecrets = secretValuesFromEnvVars(
          candidate ? candidateGradingEnv(candidate.config) : []
        );
        // Only a restart_persistence acceptance spec needs this, and only when the
        // runbook actually got the app up — replaying the exact start command.
        const restartApp = runbookResult.startExecution
          ? () =>
              restartRunbookApp(ctx, runbookResult.startExecution!, [
                ...runbook.portsHint,
                ...portsFromOrigin(sandboxAppOrigin),
              ])
          : null;

        behavioralInfo("sandbox_app_access", {
          sandboxAppOrigin: sandboxAppOrigin ?? null,
          browserBaseUrl: browserBaseUrl ?? null,
          discoverySource: appAccess.discoverySource ?? null,
        });

        const assessmentTitle =
          typeof assessment?.title === "string" ? assessment.title : "Assessment";
        const assessmentDescription = assessmentDescriptionExcerpt(assessment);

        const readmeExcerpt = readmeText.slice(0, 6000);
        const judgeArtifacts = await collectJudgeArtifacts(
          ctx,
          repoPath,
          runbook,
          sandboxAppOrigin,
          ctx.sandbox
        );
        const httpEx = judgeArtifacts.httpBodyExcerpt || "";
        const appReachable =
          setup.status !== "failed" &&
          (setup.healthWait?.ready ?? setup.status === "ready");
        const runtimeHints = {
          baseUrlAvailable: Boolean(sandboxAppOrigin?.trim()) && appReachable,
          anyRunbookCommandFailed: runbookResult.evidence.some(
            (e) => e.type === "command" && !e.success
          ),
          httpSeedFetchOk:
            Boolean(sandboxAppOrigin?.trim()) &&
            Boolean(httpEx) &&
            !httpEx.startsWith("In-sandbox curl failed"),
        };
        behavioralInfo("artifacts_collected", {
          entryCommand: judgeArtifacts.entryCommand,
          mainSourcePath: judgeArtifacts.mainSourcePath,
          runtimeHints,
        });

        const cases: BehavioralCaseResult[] = [];
        const orderedChecks = orderChecksForIsolation(behavioralChecks);
        const setupFailed = setup.status === "failed";
        const browserSession =
          browserBaseUrl?.trim() && !setupFailed
            ? new BehavioralBrowserSession()
            : null;

        let ariaSnapshot: string | undefined;
        if (
          browserSession &&
          browserBaseUrl?.trim() &&
          !resolvedSpecs.downgradedByFlag &&
          specsByIndex.some((s) => s.kind === "agent")
        ) {
          ariaSnapshot = await captureAriaSnapshot({
            session: browserSession,
            baseUrl: browserBaseUrl,
          });
        }

        try {
          for (let ord = 0; ord < orderedChecks.length; ord += 1) {
            const { checkText, originalIndex: checkIndex } =
              orderedChecks[ord];
            let spec = specsByIndex[checkIndex];
            let compiledAtGrade = false;
            const startedAtJudge = new Date().toISOString();
            const otherBehavioralChecks = behavioralChecks.filter(
              (_, j) => j !== checkIndex
            );

            // A spec states its own interface, so its kind decides whether a live
            // app is required; only a plain-language check needs the heuristic.
            const needsRunningApp =
              spec.kind === "agent"
                ? checkRequiresRunningApp(checkText)
                : spec.kind !== "cli";

            // The app never came up. Judging a runtime behavior anyway produces a
            // verdict about software that never ran — and costs a full agent loop
            // per check to produce it. Report it as blocked and spend nothing.
            if (setupFailed && needsRunningApp) {
              behavioralInfo("judge_check_blocked", {
                index: ord + 1,
                checkIndex,
                total: behavioralChecks.length,
                setupPhase: setup.phase,
              });
              await safeProgress(() =>
                progress.addCompletedCheck({
                  checkIndex,
                  checkText,
                  verdict: "blocked",
                  verifiedBy: spec.kind,
                })
              );
              cases.push({
                checkText,
                checkIndex,
                checkId: spec.id,
                verifiedBy: spec.kind,
                verdict: "blocked",
                artifacts: [],
                evidence: [
                  {
                    id: randomUUID(),
                    type: "judge",
                    startedAt: startedAtJudge,
                    finishedAt: new Date().toISOString(),
                    success: false,
                    verdict: "blocked",
                    rationale: `Not judged: the environment never reached a runnable state, so this behavior could not be observed. ${setup.summary}`,
                    citations: [],
                    input: { setupStatus: setup.status, setupPhase: setup.phase },
                  },
                ],
              });
              continue;
            }

            if (browserSession) {
              await browserSession.resetIsolation();
            }

            // Leftover agent checks compile to a machine-run spec against the
            // live page. The agent's *choices* must not decide a hiring verdict.
            if (spec.kind === "agent" && !resolvedSpecs.downgradedByFlag) {
              await safeProgress(() =>
                progress.beginCheck(
                  checkIndex,
                  checkText,
                  `Compiling acceptance: ${previewCommand(checkText, 72)}`
                )
              );
              const compiled = await compileCheckSpec({
                checkText,
                checkId: spec.id,
                assessmentDescription,
                catalog: uiCatalog,
                capabilities,
                ariaSnapshot,
                sandboxAppOrigin,
              });
              if (!compiled.ok) {
                behavioralInfo("compile_spec_undecided", {
                  index: ord + 1,
                  checkIndex,
                  reason: compiled.reason,
                });
                await safeProgress(() =>
                  progress.addCompletedCheck({
                    checkIndex,
                    checkText,
                    verdict: "inconclusive",
                  })
                );
                cases.push({
                  checkText,
                  checkIndex,
                  checkId: spec.id,
                  verdict: "inconclusive",
                  artifacts: [],
                  evidence: [
                    {
                      id: randomUUID(),
                      type: "judge",
                      startedAt: startedAtJudge,
                      finishedAt: new Date().toISOString(),
                      success: false,
                      verdict: "inconclusive",
                      rationale: compiled.reason,
                      citations: [],
                      input: { compileFailed: true },
                    },
                  ],
                });
                continue;
              }
              spec = compiled.spec;
              compiledAtGrade = spec.kind !== "agent";
            }

            // A check with an acceptance spec is settled by running it. No LLM
            // call, and the recorded request is the whole justification.
            if (spec.kind !== "agent") {
              await safeProgress(() =>
                progress.beginCheck(
                  checkIndex,
                  checkText,
                  `Checking (${spec.kind}): ${previewCommand(checkText, 72)}`
                )
              );
              const deterministic = await runDeterministicCheck({
                ctx,
                spec,
                sandboxAppOrigin,
                browserBaseUrl: setupFailed ? undefined : browserBaseUrl,
                browserSession: browserSession ?? undefined,
                repoPath,
                secrets: candidateSecrets,
                restartApp: restartApp ?? undefined,
                catalog: uiCatalog,
                deepenCatalog: (query, existing) =>
                  deepenUiControlsFromSandbox(ctx, repoPath, query, existing),
              });
              behavioralInfo("deterministic_check_done", {
                index: ord + 1,
                checkIndex,
                kind: spec.kind,
                verdict: deterministic.verdict,
              });
              await safeProgress(() =>
                progress.addCompletedCheck({
                  checkIndex,
                  checkText,
                  verdict: deterministic.verdict,
                  verifiedBy: spec.kind,
                })
              );
              cases.push({
                checkText,
                checkIndex,
                checkId: spec.id,
                verifiedBy: spec.kind,
                verdict: deterministic.verdict,
                artifacts: [],
                evidence: [
                  ...deterministic.evidence,
                  {
                    id: randomUUID(),
                    type: "judge",
                    startedAt: startedAtJudge,
                    finishedAt: new Date().toISOString(),
                    success: deterministic.verdict === "pass",
                    verdict: deterministic.verdict,
                    rationale: deterministic.rationale,
                    citations: deterministic.citations,
                    input: {
                      verifiedBy: spec.kind,
                      acceptance: spec.acceptance,
                      ...(compiledAtGrade ? { compiledAtGrade: true } : {}),
                    },
                  },
                ],
                ...(browserSession && spec.kind === "ui"
                  ? { isolation: "fresh_browser_context" as const }
                  : {}),
              });
              continue;
            }

            behavioralInfo("judge_check_start", {
              index: ord + 1,
              checkIndex,
              total: behavioralChecks.length,
              preview: checkText.slice(0, 100),
            });
            await safeProgress(() =>
              progress.beginCheck(
                checkIndex,
                checkText,
                `Checking: ${previewCommand(checkText, 72)}`
              )
            );

            const judgeResult = await runAgentBehavioralJudge({
              assessmentTitle,
              assessmentDescription,
              behavioralCheck: checkText,
              executionProfile,
              readmeExcerpt,
              artifacts: judgeArtifacts,
              runtimeHints,
              repoPath,
              ctx,
              sandboxAppOrigin,
              // A dead app has no browsable surface; offering the tools invites
              // the agent to spend turns on navigations that cannot succeed.
              baseUrl: setupFailed ? undefined : browserBaseUrl,
              submissionId,
              otherBehavioralChecks,
              browserSession: browserSession ?? undefined,
              manageBrowserLifecycle: !browserSession,
              onAgentStep: (entry, trace) =>
                safeProgress(() =>
                  progress.setSteps(agentTraceToProgressSteps(trace))
                ),
            });
            const finishedAtJudge = new Date().toISOString();

            const evidence: StepEvidence[] = [
              {
                id: randomUUID(),
                type: "judge",
                startedAt: startedAtJudge,
                finishedAt: finishedAtJudge,
                success: judgeResult.verdict === "pass",
                verdict: judgeResult.verdict,
                rationale: judgeResult.rationale,
                citations: judgeResult.citations,
                input: {
                  entryCommand: judgeArtifacts.entryCommand,
                  mainSourcePath: judgeArtifacts.mainSourcePath,
                },
                ...(judgeResult.agentTrace?.length
                  ? { agentTrace: judgeResult.agentTrace }
                  : {}),
              },
            ];

            const screenshotArtifactKeys = (judgeResult.agentTrace ?? [])
              .map((t) => t.artifactKey)
              .filter((k): k is string => Boolean(k));

            cases.push({
              checkText,
              checkIndex,
              checkId: spec.id,
              verifiedBy: "agent",
              verdict: judgeResult.verdict,
              evidence,
              artifacts: screenshotArtifactKeys,
              ...(browserSession
                ? { isolation: "fresh_browser_context" as const }
                : {}),
            });

            behavioralInfo("judge_check_done", {
              index: ord + 1,
              checkIndex,
              verdict: judgeResult.verdict,
              ms: Date.now() - t0,
            });
            await safeProgress(() =>
              progress.addCompletedCheck({
                checkIndex,
                checkText,
                verdict: judgeResult.verdict,
                verifiedBy: "agent",
              })
            );
          }
        } finally {
          await browserSession?.close();
        }

        cases.sort((a, b) => a.checkIndex - b.checkIndex);

        const completedAt = new Date().toISOString();
        behavioralInfo("sandbox_inner_done", { ms: Date.now() - t0 });
        const reportDraft: BehavioralGradingReport = {
          sandbox: {
            sandboxId: ctx.sandboxId,
            timeoutMs: sandboxTimeoutMs,
          },
          runbook: {
            summary: runbookSummary,
            readmeRequirementPassed: runbookResult.readmeRequirementPassed,
            readmeRequirementDetail: runbookResult.readmeRequirementDetail,
            evidence: runbookResult.evidence,
            baseUrl: browserBaseUrl,
            sandboxAppOrigin,
            sandboxAppDiscovery: appAccess.discoverySource,
            executionProfile,
          },
          setup,
          runbookSource: attempt.source,
          ...(runbookFallbackReason ? { runbookFallbackReason } : {}),
          failureCategory: setup.status === "failed" ? "setup" : null,
          cases,
          score: computeBehavioralScore(cases),
          startedAt,
          completedAt,
        };

        const reportArtifactKey = await saveReportJson(submissionId, reportDraft);
        behavioralInfo("report_saved", { reportArtifactKey });
        return {
          ...reportDraft,
          reportArtifactKey,
        };
      },
      {
        timeoutMs: sandboxTimeoutMs,
        metadata: {
          submissionId,
          gradingType: "behavioral",
        },
      }
    );

    behavioralInfo("run_complete", {
      submissionId,
      cases: report.cases.length,
      decided: report.score.decided,
      blocked: report.score.blocked,
      passRate: report.score.passRate,
      totalMs: Date.now() - t0,
      sandboxId: report.sandbox.sandboxId,
      runbookSource: report.runbookSource,
    });

    await progress.flush();
    return report;
    } finally {
      await progress.stop();
    }
    })
  );
}
