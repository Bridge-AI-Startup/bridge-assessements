import { randomUUID } from "crypto";
import SubmissionModel from "../../models/submission.js";
import { withGradingSandbox } from "../e2b/graderSandbox.js";
import { collectJudgeArtifacts } from "./artifacts.js";
import { getSubmissionCodeStorage } from "../submissionCode/storage.js";
import {
  executeRunbook,
  probeRepoLayoutForRunbook,
  readmeFromSandbox,
  saveReportJson,
  type ReadmeRequirementDetail,
  type StepEvidence,
} from "./executor.js";
import { runAgentBehavioralJudge } from "./agentJudge.js";
import { extractRunbook } from "./planner.js";
import { behavioralInfo } from "./log.js";

export type BehavioralCaseResult = {
  checkText: string;
  verdict: "pass" | "fail" | "inconclusive";
  evidence: StepEvidence[];
  artifacts: string[];
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
    executionProfile?: "cli_stdout" | "web_server" | "unclear";
  };
  cases: BehavioralCaseResult[];
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

function isUploadBehavioralEnabled(): boolean {
  const raw = process.env.BEHAVIORAL_GRADING_UPLOAD_ENABLED;
  if (!raw) return true;
  return raw === "1" || raw.toLowerCase() === "true";
}

async function withGradeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeGrades >= MAX_CONCURRENT_GRADES) {
    await new Promise<void>((resolve) => gradeQueue.push(resolve));
  }
  activeGrades += 1;
  try {
    return await fn();
  } finally {
    activeGrades -= 1;
    const next = gradeQueue.shift();
    if (next) next();
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

export async function gradeSubmissionBehavioral(
  submissionId: string
): Promise<BehavioralGradingReport> {
  return withGradeSlot(async () => {
    const t0 = Date.now();
    const submission = await SubmissionModel.findById(submissionId).populate("assessmentId");
    if (!submission) {
      throw new Error("Submission not found");
    }
    if (submission.codeSource === "upload" && !isUploadBehavioralEnabled()) {
      throw new Error(
        "Behavioral grading for uploaded archives is currently disabled."
      );
    }

    const assessment: any = submission.assessmentId;
    const behavioralChecks: string[] = Array.isArray(assessment?.behavioralChecks)
      ? assessment.behavioralChecks
      : [];
    if (behavioralChecks.length === 0) {
      throw new Error("Assessment has no behavioral checks configured.");
    }

    const startedAt = new Date().toISOString();
    const sandboxTimeoutMs = getBehavioralSandboxTimeoutMs();

    behavioralInfo("run_start", {
      submissionId,
      checks: behavioralChecks.length,
      sandboxTimeoutMs,
    });

    const report = await withGradingSandbox<BehavioralGradingReport>(
      async (ctx) => {
        behavioralInfo("sandbox_open", {
          sandboxId: ctx.sandboxId,
          sandboxTimeoutMs,
        });

        const repoPath = await cloneAndCheckout(ctx.run, submission, ctx.sandbox);
        behavioralInfo("clone_done", { repoPath });

        const readmeText = await readmeFromSandbox(ctx.sandbox, repoPath);
        const repoLayoutProbe = await probeRepoLayoutForRunbook(ctx, repoPath);
        behavioralInfo("repo_layout_probe", {
          chars: repoLayoutProbe.length,
        });
        const repoSummary = getRepoSummary(submission);

        const runbook = await extractRunbook({
          readmeText,
          repoSummary,
          repoLayoutProbe,
        });
        behavioralInfo("runbook_llm_ok", {
          steps: runbook.steps.length,
          profile: runbook.executionProfile,
        });

        const runbookResult = await executeRunbook(ctx, runbook, repoPath);
        const runbookSummary = summarizeRunbook(runbook);
        behavioralInfo("runbook_executed", {
          readmeRequirementPassed: runbookResult.readmeRequirementPassed,
          hasBaseUrl: Boolean(runbookResult.baseUrl),
        });

        const executionProfile = runbook.executionProfile ?? "unclear";
        const effectiveBaseUrl =
          executionProfile === "cli_stdout" ? undefined : runbookResult.baseUrl;

        const assessmentTitle =
          typeof assessment?.title === "string" ? assessment.title : "Assessment";
        const assessmentDescription = assessmentDescriptionExcerpt(assessment);

        const readmeExcerpt = readmeText.slice(0, 6000);
        const judgeArtifacts = await collectJudgeArtifacts(
          ctx,
          repoPath,
          runbook,
          effectiveBaseUrl,
          ctx.sandbox
        );
        const httpEx = judgeArtifacts.httpBodyExcerpt || "";
        const runtimeHints = {
          baseUrlAvailable: Boolean(effectiveBaseUrl?.trim()),
          anyRunbookCommandFailed: runbookResult.evidence.some(
            (e) => e.type === "command" && !e.success
          ),
          httpSeedFetchOk:
            Boolean(effectiveBaseUrl?.trim()) &&
            Boolean(httpEx) &&
            !httpEx.startsWith("Fetch failed"),
        };
        behavioralInfo("artifacts_collected", {
          entryCommand: judgeArtifacts.entryCommand,
          mainSourcePath: judgeArtifacts.mainSourcePath,
          runtimeHints,
        });

        const cases: BehavioralCaseResult[] = [];

        for (let i = 0; i < behavioralChecks.length; i += 1) {
          const checkText = behavioralChecks[i];
          const startedAtJudge = new Date().toISOString();
          const otherBehavioralChecks = behavioralChecks.filter(
            (_, j) => j !== i
          );

          behavioralInfo("judge_check_start", {
            index: i + 1,
            total: behavioralChecks.length,
            preview: checkText.slice(0, 100),
          });

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
            baseUrl: effectiveBaseUrl,
            submissionId,
            otherBehavioralChecks,
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
            verdict: judgeResult.verdict,
            evidence,
            artifacts: screenshotArtifactKeys,
          });

          behavioralInfo("judge_check_done", {
            index: i + 1,
            verdict: judgeResult.verdict,
            ms: Date.now() - t0,
          });
        }

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
            baseUrl: effectiveBaseUrl,
            executionProfile,
          },
          cases,
          startedAt,
          completedAt,
        };

        const reportArtifactKey = await saveReportJson(submissionId, reportDraft);
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
      totalMs: Date.now() - t0,
      sandboxId: report.sandbox.sandboxId,
    });

    return report;
  });
}
