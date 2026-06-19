/**
 * Hardcoded VP demo behavioral grading — runs entirely in the browser for
 * assessment 6a30cb825c1e8969b7c21110. No E2B, no server progress polling.
 */

export const HARDCODED_DEMO_ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";

export const HARDCODED_DEMO_CHECKS = [
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

const VARIANT_PROFILES = {
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
    verdicts: ["pass", "fail", "inconclusive", "pass", "inconclusive", "fail", "inconclusive", "inconclusive"],
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

const CHECK_CONTEXT = [
  { mainSourcePath: "dispatcher/ratelimiter.py", entryCommand: "pytest -q tests/test_dispatcher.py::test_token_bucket_limits_rate" },
  { mainSourcePath: "dispatcher/backoff.py", entryCommand: "pytest -q tests/test_dispatcher.py::test_backoff_grows_and_caps" },
  { mainSourcePath: "dispatcher/dispatcher.py", entryCommand: "grep -n Semaphore dispatcher/dispatcher.py" },
  { mainSourcePath: "dispatcher/api.py", entryCommand: "curl -s -X POST localhost:8000/webhooks ..." },
  { mainSourcePath: "dispatcher/api.py", entryCommand: "curl -s localhost:8000/webhooks/unknown-id" },
  { mainSourcePath: "dispatcher/dispatcher.py", entryCommand: "grep max_attempts config.yaml" },
  { mainSourcePath: "tests/test_dispatcher.py", entryCommand: "pytest -q" },
  { mainSourcePath: "README.md", entryCommand: "grep -E 'pip install|pytest|uvicorn' README.md" },
];

export function isHardcodedDemoAssessment(assessmentId) {
  return assessmentId === HARDCODED_DEMO_ASSESSMENT_ID;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(bytes = 8) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function profileForCandidate(candidateName, checks) {
  return (
    VARIANT_PROFILES[candidateName] ?? {
      verdicts: checks.map(() => "pass"),
      rationales: checks.map((c) => `Sandbox judge verified: ${c.slice(0, 80)}…`),
    }
  );
}

export function buildHardcodedBehavioralReport(submissionId, candidateName, checks) {
  const profile = profileForCandidate(candidateName, checks);
  const startedAt = new Date(Date.now() - 14_000).toISOString();
  const completedAt = new Date().toISOString();
  const sandboxId = `e2b_${randomHex(8)}`;

  const installEvidence = {
    type: "command",
    input: { purpose: "install", command: "pip install -r requirements.txt" },
    success: true,
    exitCode: 0,
    stdoutSnippet: INSTALL_STDOUT,
  };
  const testEvidence = {
    type: "command",
    input: { purpose: "test", command: "pytest -q" },
    success: true,
    exitCode: 0,
    stdoutSnippet: PYTEST_STDOUT,
  };
  const uvicornEvidence = {
    type: "command",
    input: {
      purpose: "start",
      command: "uvicorn dispatcher.api:app --host 127.0.0.1 --port 8000",
    },
    success: true,
    exitCode: 0,
    stdoutSnippet:
      "INFO: Uvicorn running on http://127.0.0.1:8000\nINFO: GET /health 200 OK",
  };

  const cases = checks.map((checkText, checkIndex) => {
    const ctx = CHECK_CONTEXT[checkIndex] ?? CHECK_CONTEXT[0];
    return {
      checkText,
      checkIndex,
      verdict: profile.verdicts[checkIndex] ?? "pass",
      evidence: [
        {
          type: "judge",
          input: { checkText, entryCommand: ctx.entryCommand, mainSourcePath: ctx.mainSourcePath },
          success: profile.verdicts[checkIndex] === "pass",
          verdict: profile.verdicts[checkIndex] ?? "pass",
          rationale:
            profile.rationales[checkIndex] ??
            `Sandbox judge verified: ${checkText.slice(0, 100)}`,
          citations: [ctx.mainSourcePath],
        },
      ],
      artifacts: [],
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
      healthWait: { attempted: true, ready: true, attempts: 4, elapsedMs: 6100 },
    },
    failureCategory: null,
    cases,
    startedAt,
    completedAt,
    reportArtifactKey: `submissions/${submissionId}/report.json`,
  };
}

async function revealAgentSteps(onProgress, base, templates, msPerStep, previewFor) {
  for (let i = 0; i < templates.length; i += 1) {
    const agentSteps = templates.map((t, idx) => ({
      iteration: idx + 1,
      tool: t.tool,
      detail: t.detail,
      status: idx < i ? "done" : idx === i ? "running" : "pending",
      outputPreview: idx < i && previewFor ? previewFor(idx + 1) : undefined,
    }));
    onProgress({
      ...base,
      agentSteps,
      updatedAt: new Date().toISOString(),
    });
    await sleep(msPerStep);
  }
  const agentSteps = templates.map((t, idx) => ({
    iteration: idx + 1,
    tool: t.tool,
    detail: t.detail,
    status: "done",
    outputPreview: previewFor ? previewFor(idx + 1) : undefined,
  }));
  onProgress({
    ...base,
    agentSteps,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Drive step-by-step UI updates locally (~12s). Calls onProgress repeatedly, then onComplete(report).
 */
export async function runHardcodedBehavioralDemo({
  checks,
  candidateName,
  submissionId,
  onProgress,
  onComplete,
  signal,
}) {
  const profile = profileForCandidate(candidateName, checks);
  const startedAt = new Date().toISOString();
  const completedChecks = [];
  const totalMs = 12_000;
  const setupMs = Math.round(totalMs * 0.38);
  const judgeMs = totalMs - setupMs;
  const setupStepMs = Math.max(300, Math.floor(setupMs / 4));
  const judgeStepMs = Math.max(250, Math.floor(judgeMs / Math.max(1, checks.length * 3)));

  const progressBase = () => ({
    checkIndex: null,
    checksTotal: checks.length,
    completedChecks: [...completedChecks],
    startedAt,
  });

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  onProgress({
    phase: "sandbox",
    phaseLabel: "Queued — provisioning E2B sandbox…",
    ...progressBase(),
    agentSteps: [],
    updatedAt: new Date().toISOString(),
  });
  await sleep(200);
  throwIfAborted();

  await revealAgentSteps(
    onProgress,
    { phase: "sandbox", phaseLabel: "Provisioning E2B sandbox…", ...progressBase() },
    [{ tool: "provision", detail: "e2b sandbox create" }],
    setupStepMs,
    () => "Sandbox ready"
  );
  throwIfAborted();

  await revealAgentSteps(
    onProgress,
    { phase: "install", phaseLabel: "Extracting archive & pip install…", ...progressBase() },
    [{ tool: "run_command", detail: "pip install -r requirements.txt" }],
    setupStepMs,
    () => INSTALL_STDOUT
  );
  throwIfAborted();

  await revealAgentSteps(
    onProgress,
    { phase: "test", phaseLabel: "Running pytest…", ...progressBase() },
    [{ tool: "run_command", detail: "pytest -q" }],
    setupStepMs,
    () => PYTEST_STDOUT
  );
  throwIfAborted();

  await revealAgentSteps(
    onProgress,
    {
      phase: "start",
      phaseLabel: "Starting uvicorn & health check…",
      ...progressBase(),
    },
    [
      {
        tool: "run_command",
        detail: "uvicorn dispatcher.api:app --host 127.0.0.1 --port 8000",
      },
      { tool: "http", detail: "GET /health" },
    ],
    setupStepMs,
    (iter) =>
      iter === 1
        ? "INFO: Uvicorn running on http://127.0.0.1:8000"
        : "200 OK"
  );
  throwIfAborted();

  for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {
    const checkText = checks[checkIndex];
    const ctx = CHECK_CONTEXT[checkIndex] ?? CHECK_CONTEXT[0];
    const verdict = profile.verdicts[checkIndex] ?? "pass";
    const templates = [
      { tool: "read_file", detail: ctx.mainSourcePath },
      { tool: "run_command", detail: ctx.entryCommand },
      {
        tool: "judge",
        detail: checkText.length > 72 ? `${checkText.slice(0, 72)}…` : checkText,
      },
    ];

    await revealAgentSteps(
      onProgress,
      {
        phase: "judge",
        phaseLabel: `Agent judge — check ${checkIndex + 1} of ${checks.length}`,
        checkIndex,
        checkText,
        ...progressBase(),
      },
      templates,
      judgeStepMs,
      (iter) => {
        if (iter === 1) return `…${ctx.mainSourcePath.split("/").pop()} loaded`;
        if (iter === 2 && checkIndex === 0) return PYTEST_STDOUT;
        if (iter === 2) return "exit 0";
        return undefined;
      }
    );
    throwIfAborted();

    completedChecks.push({ checkIndex, checkText, verdict });
    onProgress({
      phase: "judge",
      phaseLabel: `Check ${checkIndex + 1} — ${verdict}`,
      checkIndex,
      checkText,
      ...progressBase(),
      agentSteps: templates.map((t, idx) => ({
        iteration: idx + 1,
        tool: t.tool,
        detail: t.detail,
        status: "done",
      })),
      updatedAt: new Date().toISOString(),
    });
    await sleep(120);
    throwIfAborted();
  }

  const report = buildHardcodedBehavioralReport(submissionId, candidateName, checks);
  onComplete(report);
}
