/**
 * Simulated E2B behavioral grading for the Webhook Dispatcher VP stress demo.
 * Used by POST …/grade-behavioral (live) and seedStressDemoBehavioralGrading.ts.
 */

import crypto from "crypto";
import SubmissionModel from "../../models/submission.js";
import { getGradingEvidenceStorage } from "../gradingEvidence/storage.js";
import type { BehavioralGradingReport } from "./index.js";

export const DEFAULT_STRESS_DEMO_ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";

export const WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS = [
  "Token bucket enforces the per-destination rate limit",
  "Backoff is capped at max_delay and uses full jitter",
  "Dispatcher bounds concurrent in-flight deliveries with an asyncio semaphore",
  "POST /webhooks enqueues a webhook and returns id plus queued status",
  "GET /webhooks/{id} returns 404 for unknown webhook ids",
  "Failed deliveries retry with exponential backoff until max_attempts is reached",
  "All pytest tests pass when run from the project root",
  "README documents install, test, and uvicorn start commands",
];

const PYTEST_STDOUT = `pytest -q
....                                                                     [100%]
4 passed in 0.06s`;

const INSTALL_STDOUT =
  "Successfully installed fastapi-0.115.6 httpx-0.27.2 pytest-8.3.4 pyyaml-6.0.2 uvicorn-0.32.1";

const CURL_ENQUEUE = `curl -s -X POST localhost:8000/webhooks -H 'Content-Type: application/json' \\
  -d '{"url":"https://example.com/hook","payload":{"event":"ping"}}'
{"id":"a1b2c3d4","status":"queued"}`;

const CURL_404 = `curl -s -o /dev/null -w '%{http_code}' localhost:8000/webhooks/missing-id
404`;

/** Default simulated run duration when clicking Run in the dashboard. */
const DEFAULT_SIMULATION_MS = 14_000;

type Verdict = "pass" | "fail" | "inconclusive";

interface CheckContext {
  mainSourcePath: string;
  citation: string;
  entryCommand: string;
}

interface VariantProfile {
  verdicts: Verdict[];
  rationales: string[];
}

const CHECK_CONTEXT: CheckContext[] = [
  {
    mainSourcePath: "dispatcher/ratelimiter.py",
    citation: "tests/test_dispatcher.py",
    entryCommand: "pytest -q tests/test_dispatcher.py::test_token_bucket_limits_rate",
  },
  {
    mainSourcePath: "dispatcher/backoff.py",
    citation: "tests/test_dispatcher.py",
    entryCommand: "pytest -q tests/test_dispatcher.py::test_backoff_grows_and_caps",
  },
  {
    mainSourcePath: "dispatcher/dispatcher.py",
    citation: "dispatcher/dispatcher.py",
    entryCommand: "grep -n Semaphore dispatcher/dispatcher.py",
  },
  {
    mainSourcePath: "dispatcher/api.py",
    citation: "dispatcher/api.py",
    entryCommand: "curl -s -X POST localhost:8000/webhooks ...",
  },
  {
    mainSourcePath: "dispatcher/api.py",
    citation: "dispatcher/api.py",
    entryCommand: "curl -s localhost:8000/webhooks/unknown-id",
  },
  {
    mainSourcePath: "dispatcher/dispatcher.py",
    citation: "config.yaml",
    entryCommand: "grep max_attempts config.yaml",
  },
  {
    mainSourcePath: "tests/test_dispatcher.py",
    citation: "pytest.ini",
    entryCommand: "pytest -q",
  },
  {
    mainSourcePath: "README.md",
    citation: "README.md",
    entryCommand: "grep -E 'pip install|pytest|uvicorn' README.md",
  },
];

const VARIANT_PROFILES: Record<string, VariantProfile> = {
  "Steady writer": {
    verdicts: ["pass", "pass", "pass", "pass", "pass", "inconclusive", "pass", "pass"],
    rationales: [
      "TokenBucket.try_acquire() denied a third acquire when burst=2; per-destination buckets keyed by URL in Dispatcher._buckets.",
      "backoff_delay() applies exp = min(max_ms, base * 2**(attempt-1)) then full jitter via random.uniform(0, exp).",
      "async with self._sem wraps each HTTP POST; Semaphore initialized from config max_concurrency=16.",
      "POST /webhooks returned 200 with { id, status: 'queued' } and persisted Webhook in _store.",
      "GET /webhooks/unknown raised HTTPException 404 with detail 'unknown webhook'.",
      "Retry loop and max_attempts=6 present in source, but sandbox did not observe a full six-attempt failure path within the time budget — inconclusive on terminal FAILED state.",
      "pytest -q: 4 passed in 0.06s from project root with pythonpath=.",
      "README lists pip install -r requirements.txt, pytest -q, uvicorn dispatcher.api:app --reload.",
    ],
  },
  "Bursty typist": {
    verdicts: ["pass", "inconclusive", "pass", "pass", "fail", "pass", "pass", "inconclusive"],
    rationales: [
      "Sixth rapid enqueue to same destination blocked after burst exhausted; refill observed at 5 tokens/sec.",
      "Full jitter branch exists, but sampled delays under burst load were sparse — could not confirm uniform [0, exp] distribution.",
      "Under 20 parallel enqueues, at most 16 deliveries in-flight — matches semaphore capacity.",
      "Enqueue response included hex id and Status.QUEUED before background deliver task completed.",
      "GET /webhooks/missing returned 500 instead of 404 — missing HTTPException guard for unknown ids.",
      "Sixth failed attempt marked webhook Status.FAILED when endpoint returned repeated 503s.",
      "Full suite green after fast iteration; no collection errors.",
      "README mentions install and pytest; uvicorn start command present but buried below a comment block — inconclusive as a clear runbook step.",
    ],
  },
  "Debug / test loop": {
    verdicts: ["pass", "pass", "inconclusive", "pass", "pass", "fail", "pass", "pass"],
    rationales: [
      "Fixed monotonic refill bug found during pytest; test_token_bucket_refills now passes.",
      "Added missing min(max_ms, ...) cap after test_backoff_grows_and_caps failed on attempt=20.",
      "Semaphore wrap added via Cmd-K after reviewing asyncio docs; not load-tested under 20+ concurrent enqueues — inconclusive on effective cap.",
      "Verified enqueue JSON schema with curl after uvicorn startup.",
      "404 guard added with HTTPException after manual probe returned 500 for missing id.",
      "deliver() retries on 5xx but exits after 5 attempts while config.yaml sets max_attempts: 6 — off-by-one vs requirement.",
      "4 passed after backoff fix; git diff --stat showed dispatcher/backoff.py only.",
      "README unchanged but complete — install/test/start all present.",
    ],
  },
  "AI-assisted": {
    verdicts: [
      "pass",
      "fail",
      "inconclusive",
      "pass",
      "inconclusive",
      "fail",
      "inconclusive",
      "inconclusive",
    ],
    rationales: [
      "AI-generated TokenBucket passed unit tests; thread-safe try_acquire under concurrent acquires.",
      "backoff_delay() missing exp = min(max_ms, …) before jitter — test_backoff_grows_and_caps would fail on attempt=20 (AI patch not fully applied).",
      "AI-suggested async with self._sem pattern present; concurrency bound matches config in static review only.",
      "POST handler returns id + queued status; background asyncio.create_task used for deliver.",
      "404 handling added from AI snippet but returns plain JSON 404, not FastAPI HTTPException — behavior differs from spec.",
      "Retry loop stops after 3 attempts in submitted code; config max_attempts=6 not wired through.",
      "pytest passed in a follow-up edit session, but submitted archive predates the backoff fix — inconclusive vs bundled zip.",
      "README lists pip install; pytest and uvicorn commands copied from chat but uvicorn module path wrong in one line (dispatcher.main vs dispatcher.api).",
    ],
  },
};

export function getStressDemoAssessmentId(): string {
  return process.env.STRESS_DEMO_ASSESSMENT_ID?.trim() || DEFAULT_STRESS_DEMO_ASSESSMENT_ID;
}

export function isStressDemoAssessment(assessmentId: string): boolean {
  return assessmentId === getStressDemoAssessmentId();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

function profileForCandidate(
  candidateName: string,
  checks: string[],
): VariantProfile {
  return (
    VARIANT_PROFILES[candidateName] ?? {
      verdicts: checks.map(() => "pass" as Verdict),
      rationales: checks.map((c) => `Sandbox judge verified: ${c.slice(0, 80)}…`),
    }
  );
}

export type BuildReportOptions = {
  /** When set, timestamps are anchored to this run (simulation). Otherwise back-dated (seed). */
  runStartedAtMs?: number;
  runCompletedAtMs?: number;
};

export function buildStressDemoBehavioralReport(
  submissionId: string,
  candidateName: string,
  checks: string[] = WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS,
  options: BuildReportOptions = {},
): BehavioralGradingReport {
  const profile = profileForCandidate(candidateName, checks);
  const liveRun = options.runStartedAtMs != null && options.runCompletedAtMs != null;
  const completedMs = options.runCompletedAtMs ?? Date.now() - 41 * 60_000;
  const startedMs =
    options.runStartedAtMs ?? completedMs - 11 * 60_000;

  const offset = (msFromStart: number) => isoAt(startedMs + msFromStart);
  const sandboxId = `e2b_${crypto.randomBytes(8).toString("hex")}`;

  const installEvidence = {
    id: crypto.randomUUID(),
    type: "command" as const,
    input: { purpose: "install", command: "pip install -r requirements.txt" },
    startedAt: offset(liveRun ? 4_000 : 60_000),
    finishedAt: offset(liveRun ? 8_000 : 120_000),
    success: true,
    exitCode: 0,
    stdoutSnippet: INSTALL_STDOUT,
  };

  const testEvidence = {
    id: crypto.randomUUID(),
    type: "command" as const,
    input: { purpose: "test", command: "pytest -q" },
    startedAt: offset(liveRun ? 9_000 : 180_000),
    finishedAt: offset(liveRun ? 11_000 : 240_000),
    success: true,
    exitCode: 0,
    stdoutSnippet: PYTEST_STDOUT,
  };

  const uvicornEvidence = {
    id: crypto.randomUUID(),
    type: "command" as const,
    input: {
      purpose: "start",
      command: "uvicorn dispatcher.api:app --host 127.0.0.1 --port 8000",
    },
    startedAt: offset(liveRun ? 12_000 : 300_000),
    finishedAt: offset(liveRun ? 14_000 : 360_000),
    success: true,
    exitCode: 0,
    stdoutSnippet:
      "INFO: Uvicorn running on http://127.0.0.1:8000\nINFO: GET /health 200 OK",
  };

  const cases = checks.map((checkText, checkIndex) => {
    const verdict = profile.verdicts[checkIndex] ?? "pass";
    const ctx = CHECK_CONTEXT[checkIndex] ?? CHECK_CONTEXT[0];
    const rationale =
      profile.rationales[checkIndex] ??
      `Sandbox judge verified: ${checkText.slice(0, 100)}`;
    const judgeStart = liveRun
      ? 15_000 + checkIndex * 800
      : 420_000 + checkIndex * 60_000;

    return {
      checkText,
      checkIndex,
      verdict,
      evidence: [
        ...(checkIndex === 0 ? [installEvidence, testEvidence, uvicornEvidence] : []),
        {
          id: crypto.randomUUID(),
          type: "judge" as const,
          input: {
            checkText,
            entryCommand: ctx.entryCommand,
            mainSourcePath: ctx.mainSourcePath,
          },
          startedAt: offset(judgeStart),
          finishedAt: offset(judgeStart + (liveRun ? 700 : 45_000)),
          success: verdict === "pass",
          verdict,
          rationale,
          citations: [ctx.mainSourcePath, ctx.citation],
          agentTrace:
            checkIndex === 0
              ? [
                  {
                    iteration: 1,
                    tool: "run_command",
                    success: true,
                    detail: "pytest -q",
                    outputPreview: PYTEST_STDOUT,
                  },
                  {
                    iteration: 2,
                    tool: "run_command",
                    success: true,
                    detail: "curl POST /webhooks",
                    outputPreview: CURL_ENQUEUE,
                  },
                  {
                    iteration: 3,
                    tool: "read_file",
                    success: true,
                    detail: ctx.mainSourcePath,
                    outputPreview: "class TokenBucket:",
                  },
                ]
              : checkIndex === 4
                ? [
                    {
                      iteration: 1,
                      tool: "run_command",
                      success: true,
                      detail: "curl GET missing id",
                      outputPreview: CURL_404,
                    },
                  ]
                : undefined,
        },
      ],
      artifacts: [] as string[],
    };
  });

  return {
    sandbox: { sandboxId, timeoutMs: 1_800_000 },
    runbook: {
      summary:
        "Extracted archive → pip install → pytest → uvicorn on :8000 → probed POST/GET /webhooks and rate-limit stress per behavioral checks.",
      readmeRequirementPassed: true,
      readmeRequirementDetail: {
        passed: true,
        inferredStepCount: 3,
        hasInstallCommand: true,
        hasTestCommand: true,
        hasStartCommand: true,
        summary:
          "README lists pip install -r requirements.txt, pytest -q, and uvicorn dispatcher.api:app --reload.",
      },
      evidence: [installEvidence, testEvidence, uvicornEvidence],
      baseUrl: "http://127.0.0.1:8000",
      executionProfile: "web_server",
    },
    setup: {
      status: "ready",
      phase: "complete",
      summary: "Runbook install/test succeeded; GET /health returned 200 within 6s.",
      failedSteps: [],
      healthWait: {
        attempted: true,
        ready: true,
        attempts: 4,
        elapsedMs: 6100,
      },
    },
    failureCategory: null,
    cases,
    startedAt: isoAt(startedMs),
    completedAt: isoAt(completedMs),
    reportArtifactKey: `submissions/${submissionId}/report.json`,
  };
}

function simulationDelayMs(): number {
  const raw = process.env.STRESS_DEMO_BEHAVIORAL_SIMULATION_MS;
  if (!raw?.trim()) return DEFAULT_SIMULATION_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 3_000 ? n : DEFAULT_SIMULATION_MS;
}

export type SimAgentStep = {
  iteration: number;
  tool: string;
  detail: string;
  status: "pending" | "running" | "done";
  outputPreview?: string;
};

export type BehavioralGradingProgress = {
  phase: "sandbox" | "install" | "test" | "start" | "judge";
  phaseLabel: string;
  checkIndex: number | null;
  checksTotal: number;
  checkText?: string;
  agentSteps: SimAgentStep[];
  completedChecks: Array<{
    checkIndex: number;
    checkText: string;
    verdict: Verdict;
  }>;
  startedAt: string;
  updatedAt: string;
};

async function writeBehavioralProgress(
  submissionId: string,
  progress: BehavioralGradingProgress,
): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: { behavioralGradingProgress: progress },
  });
}

async function clearBehavioralProgress(submissionId: string): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $unset: { behavioralGradingProgress: "" },
  });
}

function stepOutputPreview(checkIndex: number, iteration: number): string | undefined {
  if (iteration === 1) {
    const path = CHECK_CONTEXT[checkIndex]?.mainSourcePath ?? "dispatcher/ratelimiter.py";
    if (path.endsWith(".py")) return `…${path.split("/").pop()} loaded`;
    return path;
  }
  if (iteration === 2) {
    if (checkIndex === 0) return PYTEST_STDOUT;
    if (checkIndex === 4) return CURL_404;
    if (checkIndex === 6) return PYTEST_STDOUT;
    return "exit 0";
  }
  return undefined;
}

function judgeStepsForCheck(checkIndex: number, checkText: string): SimAgentStep[] {
  const ctx = CHECK_CONTEXT[checkIndex] ?? CHECK_CONTEXT[0];
  return [
    {
      iteration: 1,
      tool: "read_file",
      detail: ctx.mainSourcePath,
      status: "pending",
    },
    {
      iteration: 2,
      tool: "run_command",
      detail: ctx.entryCommand,
      status: "pending",
    },
    {
      iteration: 3,
      tool: "judge",
      detail: checkText.length > 72 ? `${checkText.slice(0, 72)}…` : checkText,
      status: "pending",
    },
  ];
}

async function revealSteps(
  submissionId: string,
  base: Omit<BehavioralGradingProgress, "agentSteps" | "updatedAt">,
  templates: SimAgentStep[],
  msPerStep: number,
  previewFor?: (iteration: number) => string | undefined,
): Promise<void> {
  for (let i = 0; i < templates.length; i += 1) {
    const agentSteps = templates.map((t, idx) => ({
      ...t,
      status: (idx < i ? "done" : idx === i ? "running" : "pending") as SimAgentStep["status"],
      outputPreview:
        idx < i && previewFor ? previewFor(t.iteration) : undefined,
    }));
    await writeBehavioralProgress(submissionId, {
      ...base,
      agentSteps,
      updatedAt: new Date().toISOString(),
    });
    await sleep(msPerStep);
  }
  const agentSteps = templates.map((t) => ({
    ...t,
    status: "done" as const,
    outputPreview: previewFor ? previewFor(t.iteration) : undefined,
  }));
  await writeBehavioralProgress(submissionId, {
    ...base,
    agentSteps,
    updatedAt: new Date().toISOString(),
  });
}

/** Simulates E2B grading with staged delays; streams progress to Mongo for live UI. */
export async function runStressDemoBehavioralSimulation(
  submissionId: string,
): Promise<BehavioralGradingReport> {
  const submission = await SubmissionModel.findById(submissionId).populate("assessmentId");
  if (!submission) {
    throw new Error("Submission not found");
  }

  const assessment: any = submission.assessmentId;
  if (!assessment || !isStressDemoAssessment(assessment._id.toString())) {
    throw new Error("Not a stress demo assessment submission");
  }

  const checks: string[] = Array.isArray(assessment.behavioralChecks)
    ? assessment.behavioralChecks.filter((c: unknown): c is string => typeof c === "string")
    : WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS;

  const candidateName =
    submission.candidateName || submission.candidateEmail || "Unknown";
  const profile = profileForCandidate(candidateName, checks);

  const totalMs = simulationDelayMs();
  const setupMs = Math.round(totalMs * 0.38);
  const judgeMs = totalMs - setupMs;
  const setupStepMs = Math.max(350, Math.floor(setupMs / 4));
  const judgeStepMs = Math.max(280, Math.floor(judgeMs / Math.max(1, checks.length * 3)));

  const runStartedAtMs = Date.now();
  const startedAt = isoAt(runStartedAtMs);
  const completedChecks: BehavioralGradingProgress["completedChecks"] = [];

  console.log(
    `[stress-demo-sim] Starting simulated behavioral grading for ${submissionId} (${candidateName})`,
  );

  const progressBase = (): Omit<BehavioralGradingProgress, "phase" | "phaseLabel" | "agentSteps" | "updatedAt"> => ({
    checkIndex: null,
    checksTotal: checks.length,
    completedChecks: [...completedChecks],
    startedAt,
  });

  await revealSteps(
    submissionId,
    {
      ...progressBase(),
      phase: "sandbox",
      phaseLabel: "Provisioning E2B sandbox…",
    },
    [
      { iteration: 1, tool: "provision", detail: "e2b sandbox create", status: "pending" },
    ],
    setupStepMs,
    () => "Sandbox ready",
  );

  await revealSteps(
    submissionId,
    {
      ...progressBase(),
      phase: "install",
      phaseLabel: "Extracting archive & pip install…",
    },
    [
      { iteration: 1, tool: "run_command", detail: "pip install -r requirements.txt", status: "pending" },
    ],
    setupStepMs,
    () => INSTALL_STDOUT,
  );

  await revealSteps(
    submissionId,
    {
      ...progressBase(),
      phase: "test",
      phaseLabel: "Running pytest…",
    },
    [
      { iteration: 1, tool: "run_command", detail: "pytest -q", status: "pending" },
    ],
    setupStepMs,
    () => PYTEST_STDOUT,
  );

  await revealSteps(
    submissionId,
    {
      ...progressBase(),
      phase: "start",
      phaseLabel: "Starting uvicorn & health check…",
    },
    [
      {
        iteration: 1,
        tool: "run_command",
        detail: "uvicorn dispatcher.api:app --host 127.0.0.1 --port 8000",
        status: "pending",
      },
      { iteration: 2, tool: "http", detail: "GET /health", status: "pending" },
    ],
    setupStepMs,
    (iter) =>
      iter === 1
        ? "INFO: Uvicorn running on http://127.0.0.1:8000"
        : "200 OK",
  );

  for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {
    const checkText = checks[checkIndex]!;
    const verdict = profile.verdicts[checkIndex] ?? "pass";
    const templates = judgeStepsForCheck(checkIndex, checkText);

    await revealSteps(
      submissionId,
      {
        ...progressBase(),
        phase: "judge",
        phaseLabel: `Agent judge — check ${checkIndex + 1} of ${checks.length}`,
        checkIndex,
        checkText,
      },
      templates,
      judgeStepMs,
      (iter) => stepOutputPreview(checkIndex, iter),
    );

    completedChecks.push({ checkIndex, checkText, verdict });
    await writeBehavioralProgress(submissionId, {
      ...progressBase(),
      phase: "judge",
      phaseLabel: `Check ${checkIndex + 1} — ${verdict}`,
      checkIndex,
      checkText,
      agentSteps: templates.map((t) => ({
        ...t,
        status: "done",
        outputPreview: stepOutputPreview(checkIndex, t.iteration),
      })),
      updatedAt: new Date().toISOString(),
    });
    await sleep(150);
  }

  const runCompletedAtMs = Date.now();
  const report = buildStressDemoBehavioralReport(submissionId, candidateName, checks, {
    runStartedAtMs,
    runCompletedAtMs,
  });

  const gradingStorage = getGradingEvidenceStorage();
  if (report.reportArtifactKey) {
    await gradingStorage.storeText(
      report.reportArtifactKey,
      JSON.stringify(report, null, 2),
    );
  }

  await clearBehavioralProgress(submissionId);

  console.log(
    `[stress-demo-sim] Completed in ${((runCompletedAtMs - runStartedAtMs) / 1000).toFixed(1)}s — sandbox ${report.sandbox.sandboxId}`,
  );

  return report;
}

/** Mark pending and return immediately — call before HTTP 202. */
export async function beginStressDemoBehavioralSimulation(
  submissionId: string,
): Promise<void> {
  const submission = await SubmissionModel.findById(submissionId).populate("assessmentId");
  if (!submission) {
    throw new Error("Submission not found");
  }
  const assessment: any = submission.assessmentId;
  if (!assessment || !isStressDemoAssessment(assessment._id.toString())) {
    throw new Error("Not a stress demo assessment submission");
  }
  const checks: string[] = Array.isArray(assessment.behavioralChecks)
    ? assessment.behavioralChecks.filter((c: unknown): c is string => typeof c === "string")
    : WEBHOOK_DISPATCHER_BEHAVIORAL_CHECKS;

  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      behavioralGradingStatus: "pending",
      behavioralGradingError: null,
      behavioralGradingReport: null,
      behavioralGradingProgress: {
        phase: "sandbox",
        phaseLabel: "Queued — provisioning E2B sandbox…",
        checkIndex: null,
        checksTotal: checks.length,
        agentSteps: [],
        completedChecks: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

function finishStressDemoSimulation(submissionId: string, report: BehavioralGradingReport) {
  return SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      behavioralGradingStatus: "completed",
      behavioralGradingError: null,
      behavioralGradingReport: report,
    },
    $unset: { behavioralGradingProgress: "" },
  });
}

function failStressDemoSimulation(submissionId: string, message: string) {
  return SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      behavioralGradingStatus: "failed",
      behavioralGradingError: message,
      behavioralGradingReport: null,
    },
    $unset: { behavioralGradingProgress: "" },
  });
}

/** Fire-and-forget simulated run (matches real E2B background pattern). */
export function triggerStressDemoBehavioralSimulationInBackground(
  submissionId: string,
): void {
  runStressDemoBehavioralSimulation(submissionId)
    .then((report) => finishStressDemoSimulation(submissionId, report))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err ?? "unknown error");
      console.error(
        `[stress-demo-sim] Simulation failed for ${submissionId}: ${message}`,
      );
      failStressDemoSimulation(submissionId, message).catch(() => {});
    });
}
