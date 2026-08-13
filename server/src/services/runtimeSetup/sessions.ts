import createHttpError from "http-errors";
import type { Sandbox } from "e2b";
import SubmissionModel from "../../models/submission.js";
import RuntimeSetupSessionModel from "../../models/runtimeSetupSession.js";
import { isE2bConfigured } from "../e2b/graderSandbox.js";
import { extractRunbook } from "../behavioralGrading/planner.js";
import {
  probeRepoLayoutForRunbook,
  readmeFromSandbox,
} from "../behavioralGrading/executor.js";
import {
  isRuntimeSetupEnabled,
  getRuntimeSetupMaxConcurrent,
  getRuntimeSetupCpu,
  getRuntimeSetupMemMiB,
  getRuntimeSetupRunsPerHour,
  isBusyRunPhase,
} from "./config.js";
import {
  emptyRuntimeConfig,
  runtimeConfigSchema,
  snapshotShaFromSubmission,
  type RuntimeConfig,
} from "./schema.js";
import {
  mergeRuntimeConfig,
  publicRuntimeConfig,
  secretValues,
} from "./secrets.js";
import {
  appendLiveLog,
  dropLiveLogs,
  getLiveLogs,
  hydrateLiveFromSession,
  persistLiveLogs,
  resetLiveLogs,
  setLiveSecrets,
} from "./logs.js";
import {
  connectRuntimeSandbox,
  createRuntimeSandbox,
  killRuntimeSandbox,
  pauseRuntimeSandbox,
  toRuntimeCtx,
} from "./sandbox.js";
import { loadSubmissionCodeIntoSandbox } from "./loadCode.js";
import { executeRuntimeConfig } from "./run.js";
import { createKeyedAsyncLock } from "./lock.js";

const withSubmissionLock = createKeyedAsyncLock();
const runTimestamps = new Map<string, number[]>();
/** submissionId → sandboxId of the in-flight executeRuntimeConfig. */
const inFlightRuns = new Map<string, string>();

/** Live box the candidate can Run against (not merely a session document). */
export function isLiveSetupSandbox(session: {
  e2bSandboxId?: string | null;
  status?: string | null;
} | null | undefined): boolean {
  return Boolean(
    session?.e2bSandboxId &&
      (session.status === "running" || session.status === "paused")
  );
}

/**
 * A background run must not write session/submission results if restart or
 * finalize already replaced or killed the box it started on.
 */
export function shouldApplyRuntimeRunResult(input: {
  expectedSandboxId?: string | null;
  currentSandboxId?: string | null;
  sessionStatus?: string | null;
  setupStatus?: string | null;
}): boolean {
  if (input.setupStatus === "finalized") return false;
  if (input.sessionStatus === "dead") return false;
  if (!input.expectedSandboxId) return false;
  return input.currentSandboxId === input.expectedSandboxId;
}

export function assertRuntimeSetupEnabled(): void {
  if (!isRuntimeSetupEnabled()) {
    throw createHttpError(404, "Runtime setup is not enabled");
  }
}

function assertSubmittedWithCode(submission: {
  status?: string;
  codeSource?: string;
  codeUpload?: { storageKey?: string | null };
  githubRepo?: { owner?: string | null; repo?: string | null };
}): void {
  if (submission.status !== "submitted" && submission.status !== "expired") {
    throw createHttpError(400, "Submission is not ready for runtime setup");
  }
  const hasUpload = Boolean(submission.codeUpload?.storageKey);
  const hasGithub = Boolean(
    submission.githubRepo?.owner && submission.githubRepo?.repo
  );
  if (!hasUpload && !hasGithub) {
    throw createHttpError(400, "No submitted code snapshot to run");
  }
}

function assertNotFinalized(submission: {
  runtimeSetup?: { status?: string };
}): void {
  if (submission.runtimeSetup?.status === "finalized") {
    throw createHttpError(409, "Runtime setup is already finalized");
  }
}

function countRecentRuns(submissionId: string): number {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const stamps = (runTimestamps.get(submissionId) || []).filter((t) => t > hourAgo);
  runTimestamps.set(submissionId, stamps);
  return stamps.length;
}

function recordRun(submissionId: string): void {
  const stamps = runTimestamps.get(submissionId) || [];
  stamps.push(Date.now());
  runTimestamps.set(submissionId, stamps);
}

type RuntimeSetupFields = {
  status?: string;
  verified?: boolean;
  lastRunAt?: Date | null;
  lastRunResult?: {
    ok?: boolean | null;
    exitCode?: number | null;
    error?: string | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
  } | null;
  finalizedAt?: Date | null;
  snapshotSha256?: string | null;
};

/**
 * Mutate the nested runtimeSetup subdoc in place. Replacing it with a spread
 * of the Mongoose subdocument writes `lastRunResult: undefined`, which fails
 * validation (`Cast to Object failed`).
 */
export function applyRuntimeSetupPatch(
  submission: { runtimeSetup?: RuntimeSetupFields | null },
  patch: RuntimeSetupFields
): void {
  if (submission.runtimeSetup && typeof submission.runtimeSetup === "object") {
    Object.assign(submission.runtimeSetup, patch);
    return;
  }
  submission.runtimeSetup = { ...patch };
}

export function markRuntimeSetupInProgress(submission: {
  runtimeSetup?: { status?: string; verified?: boolean } | null;
}): void {
  if (!isRuntimeSetupEnabled()) return;
  if (submission.runtimeSetup?.status === "finalized") return;
  applyRuntimeSetupPatch(submission, {
    status: "in_progress",
    verified: Boolean(submission.runtimeSetup?.verified),
  });
}

/** Kill the E2B box and mark the session dead so a failed run cannot keep a seat. */
async function destroySessionSandbox(
  sessionId: string,
  error: string,
  expectedSandboxId?: string | null
): Promise<void> {
  const session = await RuntimeSetupSessionModel.findById(sessionId);
  if (!session) return;
  if (
    expectedSandboxId &&
    session.e2bSandboxId !== expectedSandboxId
  ) {
    return;
  }
  if (session.e2bSandboxId) {
    await killRuntimeSandbox(session.e2bSandboxId);
  }
  appendLiveLog(sessionId, "system", `Sandbox closed after failure: ${error}`);
  session.status = "dead";
  session.e2bSandboxId = null;
  session.previewUrl = null;
  session.port = null;
  session.codeLoaded = false;
  session.repoPath = null;
  session.runPhase = "failed";
  session.error = error;
  session.lastActiveAt = new Date();
  await session.save();
  await persistLiveLogs(sessionId);
}

async function isCurrentRunStillActive(
  sessionId: string,
  submissionId: string,
  expectedSandboxId: string
): Promise<boolean> {
  const [session, submission] = await Promise.all([
    RuntimeSetupSessionModel.findById(sessionId),
    SubmissionModel.findById(submissionId).select("runtimeSetup.status"),
  ]);
  return shouldApplyRuntimeRunResult({
    expectedSandboxId,
    currentSandboxId: session?.e2bSandboxId,
    sessionStatus: session?.status,
    setupStatus: submission?.runtimeSetup?.status,
  });
}

export function publicConfigForSubmission(submission: {
  runtimeConfig?: RuntimeConfig | null;
}): RuntimeConfig {
  return (
    publicRuntimeConfig(submission.runtimeConfig as RuntimeConfig) ||
    emptyRuntimeConfig()
  );
}

async function loadSubmissionByToken(token: string) {
  const submission = await SubmissionModel.findOne({ token });
  if (!submission) throw createHttpError(404, "Submission not found");
  return submission;
}

async function countRunningSandboxes(): Promise<number> {
  return RuntimeSetupSessionModel.countDocuments({
    status: "running",
  });
}

async function touchSession(session: {
  lastActiveAt?: Date;
  save: () => Promise<unknown>;
}): Promise<void> {
  session.lastActiveAt = new Date();
  await session.save();
}

function sessionPublic(session: {
  _id: { toString(): string };
  status: string;
  runPhase?: string;
  port?: number | null;
  previewUrl?: string | null;
  health?: { ok?: boolean; summary?: string | null; checkedAt?: Date | null };
  startedAt?: Date | null;
  lastActiveAt?: Date | null;
  pausedAt?: Date | null;
  error?: string | null;
  e2bSandboxId?: string | null;
}) {
  return {
    sessionId: session._id.toString(),
    status: session.status,
    runPhase: session.runPhase || "idle",
    port: session.port ?? null,
    previewUrl: session.previewUrl ?? null,
    health: {
      ok: Boolean(session.health?.ok),
      summary: session.health?.summary ?? null,
      checkedAt: session.health?.checkedAt
        ? new Date(session.health.checkedAt).toISOString()
        : null,
    },
    startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
    lastActiveAt: session.lastActiveAt
      ? new Date(session.lastActiveAt).toISOString()
      : null,
    pausedAt: session.pausedAt ? new Date(session.pausedAt).toISOString() : null,
    error: session.error ?? null,
    hasSandbox: Boolean(session.e2bSandboxId),
  };
}

export async function getRuntimeStatus(token: string) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  const session = await RuntimeSetupSessionModel.findOne({
    submissionId: submission._id,
    kind: "setup",
  });
  if (session) hydrateLiveFromSession(session as never);
  return {
    enabled: true,
    config: publicConfigForSubmission(submission as never),
    setup: submission.runtimeSetup || {
      status: "not_started",
      verified: false,
    },
    session: session ? sessionPublic(session as never) : null,
  };
}

export async function saveRuntimeConfig(token: string, raw: unknown) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  assertSubmittedWithCode(submission as never);
  assertNotFinalized(submission as never);

  const parsed = runtimeConfigSchema.parse(raw);
  const merged = mergeRuntimeConfig(
    submission.runtimeConfig as RuntimeConfig | undefined,
    parsed
  );
  submission.runtimeConfig = merged as never;
  if (submission.runtimeSetup?.status !== "finalized") {
    applyRuntimeSetupPatch(submission, {
      status: "in_progress",
      verified: Boolean(submission.runtimeSetup?.verified),
    });
  }
  await submission.save();
  return { config: publicRuntimeConfig(merged) };
}

async function ensureSandboxOnSession(
  session: InstanceType<typeof RuntimeSetupSessionModel>,
  submission: InstanceType<typeof SubmissionModel>
): Promise<Sandbox> {
  if (session.e2bSandboxId && session.status !== "dead") {
    try {
      const sandbox = await connectRuntimeSandbox(session.e2bSandboxId);
      session.status = "running";
      session.pausedAt = null;
      session.error = null;
      session.lastActiveAt = new Date();
      await session.save();
      return sandbox;
    } catch (err) {
      console.warn(
        `[runtime-setup] reconnect failed for ${session.e2bSandboxId}:`,
        err instanceof Error ? err.message : err
      );
      session.e2bSandboxId = null;
      session.status = "dead";
      session.codeLoaded = false;
      session.previewUrl = null;
      await session.save();
    }
  }

  if (session.e2bSandboxId) {
    await killRuntimeSandbox(session.e2bSandboxId);
    session.e2bSandboxId = null;
    session.codeLoaded = false;
    session.previewUrl = null;
  }

  const running = await countRunningSandboxes();
  if (running >= getRuntimeSetupMaxConcurrent()) {
    throw createHttpError(
      503,
      "Runtime setup environments are at capacity. Try again shortly."
    );
  }

  session.status = "provisioning";
  await session.save();

  const sandbox = await createRuntimeSandbox({
    purpose: "runtime-setup",
    submissionId: submission._id.toString(),
    sessionId: session._id.toString(),
  });

  session.e2bSandboxId = sandbox.sandboxId;
  session.status = "running";
  session.startedAt = new Date();
  session.lastActiveAt = new Date();
  session.pausedAt = null;
  session.cpu = getRuntimeSetupCpu();
  session.memMiB = getRuntimeSetupMemMiB();
  session.error = null;
  session.codeLoaded = false;
  session.repoPath = null;
  await session.save();
  return sandbox;
}

async function ensureCodeLoaded(
  sandbox: Sandbox,
  session: InstanceType<typeof RuntimeSetupSessionModel>,
  submission: InstanceType<typeof SubmissionModel>
): Promise<string> {
  if (session.codeLoaded && session.repoPath) {
    const ctx = toRuntimeCtx(sandbox);
    const probe = await ctx.run(
      `test -d ${JSON.stringify(session.repoPath)} && echo __ok__`,
      { timeoutMs: 10_000 }
    );
    if (probe.exitCode === 0 && (probe.stdout || "").includes("__ok__")) {
      return session.repoPath;
    }
  }
  const ctx = toRuntimeCtx(sandbox);
  appendLiveLog(session._id.toString(), "system", "Loading submitted code into sandbox…");
  const repoPath = await loadSubmissionCodeIntoSandbox(ctx, submission as never);
  session.repoPath = repoPath;
  session.codeLoaded = true;
  await session.save();
  appendLiveLog(session._id.toString(), "system", `Code ready at ${repoPath}`);
  await persistLiveLogs(session._id.toString());
  return repoPath;
}

export async function createOrResumeSession(token: string) {
  assertRuntimeSetupEnabled();
  if (!isE2bConfigured()) {
    throw createHttpError(503, "E2B is not configured on this server");
  }
  const submission = await loadSubmissionByToken(token);
  assertSubmittedWithCode(submission as never);
  assertNotFinalized(submission as never);

  return withSubmissionLock(submission._id.toString(), async () => {
    let session = await RuntimeSetupSessionModel.findOne({
      submissionId: submission._id,
      kind: "setup",
    });
    if (!session) {
      session = await RuntimeSetupSessionModel.create({
        submissionId: submission._id,
        token: submission.token,
        kind: "setup",
        status: "provisioning",
        lastActiveAt: new Date(),
      });
    }
    hydrateLiveFromSession(session as never);
    resetLiveLogs(session._id.toString(), secretValues(submission.runtimeConfig as RuntimeConfig));

    try {
      const sandbox = await ensureSandboxOnSession(session, submission);
      await ensureCodeLoaded(sandbox, session, submission);

      if (
        !submission.runtimeConfig?.startCommand &&
        !submission.runtimeConfig?.installCommand
      ) {
        try {
          const guessed = await guessConfigFromSandbox(sandbox, session.repoPath || "");
          if (guessed) {
            submission.runtimeConfig = mergeRuntimeConfig(
              submission.runtimeConfig as RuntimeConfig | undefined,
              guessed
            ) as never;
            await submission.save();
          }
        } catch (err) {
          console.warn(
            "[runtime-setup] prefill guess failed:",
            err instanceof Error ? err.message : err
          );
        }
      }

      if (submission.runtimeSetup?.status !== "finalized") {
        applyRuntimeSetupPatch(submission, {
          status: "in_progress",
          verified: Boolean(submission.runtimeSetup?.verified),
        });
        await submission.save();
      }

      return {
        config: publicConfigForSubmission(submission as never),
        session: sessionPublic(session as never),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latest = await RuntimeSetupSessionModel.findById(session._id);
      if (latest?.e2bSandboxId) {
        await destroySessionSandbox(session._id.toString(), message);
      }
      throw err;
    }
  });
}

export async function restartSession(token: string) {
  assertRuntimeSetupEnabled();
  if (!isE2bConfigured()) {
    throw createHttpError(503, "E2B is not configured on this server");
  }
  const submission = await loadSubmissionByToken(token);
  assertSubmittedWithCode(submission as never);
  assertNotFinalized(submission as never);

  return withSubmissionLock(submission._id.toString(), async () => {
    inFlightRuns.delete(submission._id.toString());
    let session = await RuntimeSetupSessionModel.findOne({
      submissionId: submission._id,
      kind: "setup",
    });
    if (!session) {
      session = await RuntimeSetupSessionModel.create({
        submissionId: submission._id,
        token: submission.token,
        kind: "setup",
        status: "provisioning",
        lastActiveAt: new Date(),
      });
    }

    const previousSandboxId = session.e2bSandboxId;
    session.e2bSandboxId = null;
    session.status = "dead";
    session.codeLoaded = false;
    session.repoPath = null;
    session.previewUrl = null;
    session.port = null;
    session.runPhase = "idle";
    session.error = null;
    session.startedAt = null;
    session.health = { ok: false, summary: null, checkedAt: null };
    await session.save();
    if (previousSandboxId) {
      await killRuntimeSandbox(previousSandboxId);
    }

    resetLiveLogs(
      session._id.toString(),
      secretValues(submission.runtimeConfig as RuntimeConfig)
    );
    appendLiveLog(session._id.toString(), "system", "Restarting environment…");

    try {
      const sandbox = await ensureSandboxOnSession(session, submission);
      await ensureCodeLoaded(sandbox, session, submission);
      if (submission.runtimeSetup?.status !== "finalized") {
        applyRuntimeSetupPatch(submission, {
          status: "in_progress",
          verified: Boolean(submission.runtimeSetup?.verified),
        });
        await submission.save();
      }
      await persistLiveLogs(session._id.toString());
      return {
        config: publicConfigForSubmission(submission as never),
        session: sessionPublic(session as never),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latest = await RuntimeSetupSessionModel.findById(session._id);
      if (latest?.e2bSandboxId) {
        await destroySessionSandbox(session._id.toString(), message);
      }
      throw err;
    }
  });
}

async function guessConfigFromSandbox(
  sandbox: Sandbox,
  repoPath: string
): Promise<RuntimeConfig | null> {
  if (!repoPath) return null;
  const ctx = toRuntimeCtx(sandbox);
  const readme = await readmeFromSandbox(sandbox, repoPath);
  const layout = await probeRepoLayoutForRunbook(ctx, repoPath);
  try {
    const runbook = await extractRunbook({
      readmeText: readme || "(no README)",
      repoSummary: `source=runtime-setup\nrepoPath=${repoPath}`,
      repoLayoutProbe: layout,
    });
    const install = runbook.steps.find((s) => s.purpose === "install");
    const start = runbook.steps.find((s) => s.purpose === "start");
    const setup = runbook.steps.find((s) => s.purpose === "setup");
    return runtimeConfigSchema.parse({
      rootDir: start?.cwd || install?.cwd || ".",
      runtime: "auto",
      installCommand: install?.command || "",
      buildCommand: setup?.command || null,
      startCommand: start?.command || "",
      port: runbook.portsHint[0] ?? null,
      executionProfile: runbook.executionProfile,
      envVars: [],
      declaredEgressDomains: [],
    });
  } catch {
    const pkg = await ctx.run(
      `bash -lc 'test -f package.json && echo node; test -f requirements.txt -o -f pyproject.toml && echo python'`,
      { cwd: repoPath, timeoutMs: 10_000 }
    );
    const out = pkg.stdout || "";
    if (out.includes("node")) {
      return runtimeConfigSchema.parse({
        runtime: "node20",
        installCommand: "npm install",
        startCommand: "npm start",
        executionProfile: "web_server",
        port: 3000,
      });
    }
    if (out.includes("python")) {
      return runtimeConfigSchema.parse({
        runtime: "python312",
        installCommand: "pip install -r requirements.txt",
        startCommand: "python -m http.server 8000",
        executionProfile: "web_server",
        port: 8000,
      });
    }
    return null;
  }
}

export async function runSession(token: string) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  assertSubmittedWithCode(submission as never);
  assertNotFinalized(submission as never);

  const config = runtimeConfigSchema.parse(submission.runtimeConfig || {});
  if (!config.startCommand.trim()) {
    throw createHttpError(400, "Save a start command before running");
  }

  if (countRecentRuns(submission._id.toString()) >= getRuntimeSetupRunsPerHour()) {
    throw createHttpError(429, "Too many runs this hour. Wait and try again.");
  }

  return withSubmissionLock(submission._id.toString(), async () => {
    const session = await RuntimeSetupSessionModel.findOne({
      submissionId: submission._id,
      kind: "setup",
    });
    if (!session || !isLiveSetupSandbox(session)) {
      throw createHttpError(409, "Start the environment before running.");
    }

    if (
      inFlightRuns.has(submission._id.toString()) ||
      isBusyRunPhase(session.runPhase)
    ) {
      return {
        ok: true,
        accepted: true,
        config: publicConfigForSubmission(submission as never),
        setup: submission.runtimeSetup,
        session: sessionPublic(session as never),
      };
    }

    hydrateLiveFromSession(session as never);
    setLiveSecrets(session._id.toString(), secretValues(config));
    appendLiveLog(session._id.toString(), "system", "Starting run…");

    const submissionId = submission._id.toString();
    const sessionId = session._id.toString();

    let sandbox;
    let repoPath: string;
    try {
      sandbox = await ensureSandboxOnSession(session, submission);
      repoPath = await ensureCodeLoaded(sandbox, session, submission);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latest = await RuntimeSetupSessionModel.findById(sessionId);
      if (latest?.e2bSandboxId) {
        await destroySessionSandbox(sessionId, message, latest.e2bSandboxId);
      }
      throw err;
    }
    const startedSandboxId = String(sandbox.sandboxId || session.e2bSandboxId || "");
    if (!startedSandboxId) {
      throw createHttpError(409, "Start the environment before running.");
    }
    const ctx = toRuntimeCtx(sandbox);

    session.runPhase = "installing";
    session.error = null;
    session.lastActiveAt = new Date();
    await session.save();

    inFlightRuns.set(submissionId, startedSandboxId);
    recordRun(submissionId);

    void (async () => {
      try {
        const result = await executeRuntimeConfig({
          ctx,
          sessionId,
          repoPath,
          config,
          onPhase: async (phase) => {
            await RuntimeSetupSessionModel.findOneAndUpdate(
              { _id: sessionId, e2bSandboxId: startedSandboxId },
              { $set: { runPhase: phase, lastActiveAt: new Date() } }
            );
          },
          onHeartbeat: async (summary) => {
            await RuntimeSetupSessionModel.findOneAndUpdate(
              { _id: sessionId, e2bSandboxId: startedSandboxId },
              {
                $set: {
                  lastActiveAt: new Date(),
                  "health.summary": summary,
                  "health.checkedAt": new Date(),
                },
              }
            );
          },
          shouldAbort: async () =>
            !(await isCurrentRunStillActive(
              sessionId,
              submissionId,
              startedSandboxId
            )),
        });
        if (
          result.aborted ||
          !(await isCurrentRunStillActive(sessionId, submissionId, startedSandboxId))
        ) {
          return;
        }
        const setupUpdate: Record<string, unknown> = {
          "runtimeSetup.status": "in_progress",
          "runtimeSetup.lastRunAt": result.endedAt,
          "runtimeSetup.lastRunResult": {
            ok: result.ok,
            exitCode: result.exitCode,
            error: result.error,
            startedAt: result.startedAt,
            endedAt: result.endedAt,
          },
          "runtimeSetup.snapshotSha256": snapshotShaFromSubmission(
            submission as never
          ),
        };
        if (result.ok) setupUpdate["runtimeSetup.verified"] = true;
        await SubmissionModel.findOneAndUpdate(
          {
            _id: submissionId,
            "runtimeSetup.status": { $ne: "finalized" },
          },
          { $set: setupUpdate }
        );
        if (!result.ok) {
          if (result.aborted) return;
          await destroySessionSandbox(
            sessionId,
            result.error || "Run failed",
            startedSandboxId
          );
          return;
        }
        await RuntimeSetupSessionModel.findOneAndUpdate(
          { _id: sessionId, e2bSandboxId: startedSandboxId },
          {
            $set: {
              port: result.port,
              previewUrl: result.previewUrl,
              health: {
                ok: result.healthOk,
                summary: result.healthSummary,
                checkedAt: new Date(),
              },
              runPhase: "ready",
              error: null,
              status: "running",
              lastActiveAt: new Date(),
            },
          }
        );
        await persistLiveLogs(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!(await isCurrentRunStillActive(sessionId, submissionId, startedSandboxId))) {
          return;
        }
        appendLiveLog(sessionId, "system", `Run failed: ${message}`);
        await SubmissionModel.findOneAndUpdate(
          {
            _id: submissionId,
            "runtimeSetup.status": { $ne: "finalized" },
          },
          {
            $set: {
              "runtimeSetup.status": "in_progress",
              "runtimeSetup.lastRunAt": new Date(),
              "runtimeSetup.lastRunResult": {
                ok: false,
                exitCode: null,
                error: message,
                startedAt: null,
                endedAt: new Date(),
              },
            },
          }
        );
        await destroySessionSandbox(sessionId, message, startedSandboxId);
      } finally {
        if (inFlightRuns.get(submissionId) === startedSandboxId) {
          inFlightRuns.delete(submissionId);
        }
      }
    })();

    return {
      ok: true,
      accepted: true,
      config: publicConfigForSubmission(submission as never),
      setup: submission.runtimeSetup,
      session: sessionPublic(session as never),
    };
  });
}

export async function pauseSession(token: string) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  if (submission.runtimeSetup?.status === "finalized") {
    return { paused: true, sandboxPaused: false };
  }
  const session = await RuntimeSetupSessionModel.findOne({
    submissionId: submission._id,
    kind: "setup",
  });
  if (!session) return { paused: true, sandboxPaused: false };
  if (session.status === "dead" || session.status === "provisioning") {
    return { paused: true, sandboxPaused: false };
  }
  if (isBusyRunPhase(session.runPhase)) {
    return { paused: false, sandboxPaused: false };
  }
  if (!session.e2bSandboxId || session.status === "paused") {
    session.status = "paused";
    session.pausedAt = new Date();
    await session.save();
    return { paused: true, sandboxPaused: true };
  }
  const ok = await pauseRuntimeSandbox(session.e2bSandboxId);
  session.status = ok ? "paused" : session.status;
  session.pausedAt = ok ? new Date() : session.pausedAt;
  await session.save();
  return { paused: ok, sandboxPaused: ok };
}

export async function resumeSession(token: string) {
  return createOrResumeSession(token);
}

export async function finalizeSetup(token: string) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  assertSubmittedWithCode(submission as never);

  const config = runtimeConfigSchema.parse(submission.runtimeConfig || {});
  if (!config.startCommand.trim()) {
    throw createHttpError(400, "Save a start command before finalizing");
  }

  return withSubmissionLock(submission._id.toString(), async () => {
    const fresh = await loadSubmissionByToken(token);
    assertSubmittedWithCode(fresh as never);
    const lockedConfig = runtimeConfigSchema.parse(fresh.runtimeConfig || {});
    if (!lockedConfig.startCommand.trim()) {
      throw createHttpError(400, "Save a start command before finalizing");
    }

    inFlightRuns.delete(fresh._id.toString());

    const session = await RuntimeSetupSessionModel.findOne({
      submissionId: fresh._id,
      kind: "setup",
    });
    if (session) {
      const previousSandboxId = session.e2bSandboxId;
      session.status = "dead";
      session.e2bSandboxId = null;
      session.previewUrl = null;
      session.port = null;
      session.codeLoaded = false;
      session.repoPath = null;
      session.runPhase = "idle";
      session.error = null;
      session.lastActiveAt = new Date();
      await session.save();
      dropLiveLogs(session._id.toString());
      if (previousSandboxId) {
        await killRuntimeSandbox(previousSandboxId);
      }
    }

    const verified = Boolean(
      fresh.runtimeSetup?.verified || fresh.runtimeSetup?.lastRunResult?.ok
    );
    applyRuntimeSetupPatch(fresh, {
      status: "finalized",
      verified,
      finalizedAt: new Date(),
      snapshotSha256:
        fresh.runtimeSetup?.snapshotSha256 ||
        snapshotShaFromSubmission(fresh as never),
    });
    await fresh.save();

    return {
      setup: fresh.runtimeSetup,
      config: publicConfigForSubmission(fresh as never),
    };
  });
}

export async function getLogs(token: string, afterSeq = 0) {
  assertRuntimeSetupEnabled();
  const submission = await loadSubmissionByToken(token);
  const session = await RuntimeSetupSessionModel.findOne({
    submissionId: submission._id,
    kind: "setup",
  });
  if (!session) return { lines: [], nextSeq: 0 };
  hydrateLiveFromSession(session as never);
  setLiveSecrets(
    session._id.toString(),
    secretValues(submission.runtimeConfig as RuntimeConfig)
  );
  const lines = getLiveLogs(session._id.toString(), afterSeq);
  const nextSeq =
    lines.length > 0 ? lines[lines.length - 1].seq : afterSeq;
  return { lines, nextSeq };
}

const inFlightReplays = new Map<string, string>();

export function assertFinalizedForReplay(submission: {
  runtimeSetup?: { status?: string } | null;
}): void {
  if (submission.runtimeSetup?.status !== "finalized") {
    throw createHttpError(400, "Candidate has not finalized runtime setup");
  }
}

function replayLockKey(submissionId: string): string {
  return `replay:${submissionId}`;
}

function replayPublicPayload(
  submission: InstanceType<typeof SubmissionModel>,
  session: InstanceType<typeof RuntimeSetupSessionModel> | null,
  extra: { ok?: boolean; accepted?: boolean } = {}
) {
  return {
    ok: extra.ok ?? true,
    accepted: extra.accepted ?? true,
    enabled: true,
    finalized: submission.runtimeSetup?.status === "finalized",
    config: publicConfigForSubmission(submission as never),
    setup: submission.runtimeSetup || {
      status: "not_started",
      verified: false,
    },
    session: session ? sessionPublic(session as never) : null,
    snapshotSha256: submission.runtimeSetup?.snapshotSha256 || null,
    currentSnapshotSha256: snapshotShaFromSubmission(submission as never),
  };
}

function shouldApplyReplayRunResult(input: {
  expectedSandboxId?: string | null;
  currentSandboxId?: string | null;
  sessionStatus?: string | null;
}): boolean {
  if (input.sessionStatus === "dead") return false;
  if (!input.expectedSandboxId) return false;
  return input.currentSandboxId === input.expectedSandboxId;
}

/**
 * Recruiter replay of a finalized runtime config. Accepts the job and runs
 * provision + install/build/start in the background so the HTTP request
 * returns before a long MERN install can 502.
 *
 * A second POST while a replay is already in flight returns the current
 * session. A POST after ready/failed/dead kills the previous replay box and
 * starts a fresh one.
 */
export async function replayFinalizedConfig(submissionId: string) {
  assertRuntimeSetupEnabled();
  if (!isE2bConfigured()) {
    throw createHttpError(503, "E2B is not configured on this server");
  }
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) throw createHttpError(404, "Submission not found");
  assertFinalizedForReplay(submission as never);
  const config = runtimeConfigSchema.parse(submission.runtimeConfig || {});
  if (!config.startCommand.trim()) {
    throw createHttpError(400, "Finalized runtime config is missing a start command");
  }

  const sid = submission._id.toString();
  return withSubmissionLock(replayLockKey(sid), async () => {
    let session = await RuntimeSetupSessionModel.findOne({
      submissionId: submission._id,
      kind: "replay",
    });
    if (!session) {
      session = await RuntimeSetupSessionModel.create({
        submissionId: submission._id,
        token: submission.token,
        kind: "replay",
        status: "provisioning",
        lastActiveAt: new Date(),
      });
    }

    const busy =
      inFlightReplays.has(sid) || isBusyRunPhase(session.runPhase);
    if (busy) {
      hydrateLiveFromSession(session as never);
      return replayPublicPayload(submission, session, {
        ok: true,
        accepted: true,
      });
    }

    resetLiveLogs(session._id.toString(), secretValues(config));
    if (session.e2bSandboxId) {
      await killRuntimeSandbox(session.e2bSandboxId);
      session.e2bSandboxId = null;
      session.codeLoaded = false;
      session.previewUrl = null;
      session.port = null;
    }
    session.status = "provisioning";
    session.runPhase = "idle";
    session.error = null;
    session.health = { ok: false, summary: null, checkedAt: null };
    session.lastActiveAt = new Date();
    await session.save();
    appendLiveLog(session._id.toString(), "system", "Starting recruiter replay…");

    const sessionId = session._id.toString();
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    inFlightReplays.set(sid, generation);

    void (async () => {
      let startedSandboxId: string | null = null;
      try {
        if (inFlightReplays.get(sid) !== generation) return;
        const fresh = await RuntimeSetupSessionModel.findById(sessionId);
        if (!fresh || fresh.status === "dead") return;

        const sandbox = await ensureSandboxOnSession(fresh, submission);
        startedSandboxId = String(sandbox.sandboxId || fresh.e2bSandboxId || "");
        if (inFlightReplays.get(sid) !== generation) {
          return;
        }
        const afterProvision = await RuntimeSetupSessionModel.findById(sessionId);
        if (
          !afterProvision ||
          afterProvision.status === "dead" ||
          !startedSandboxId ||
          afterProvision.e2bSandboxId !== startedSandboxId
        ) {
          if (startedSandboxId) await killRuntimeSandbox(startedSandboxId);
          return;
        }

        const repoPath = await ensureCodeLoaded(sandbox, afterProvision, submission);
        if (inFlightReplays.get(sid) !== generation) return;
        const ctx = toRuntimeCtx(sandbox);
        const result = await executeRuntimeConfig({
          ctx,
          sessionId,
          repoPath,
          config,
          onPhase: async (phase) => {
            await RuntimeSetupSessionModel.findOneAndUpdate(
              { _id: sessionId, e2bSandboxId: startedSandboxId },
              { $set: { runPhase: phase, lastActiveAt: new Date() } }
            );
          },
          onHeartbeat: async (summary) => {
            await RuntimeSetupSessionModel.findOneAndUpdate(
              { _id: sessionId, e2bSandboxId: startedSandboxId },
              {
                $set: {
                  lastActiveAt: new Date(),
                  "health.summary": summary,
                  "health.checkedAt": new Date(),
                },
              }
            );
          },
          shouldAbort: async () => {
            const current = await RuntimeSetupSessionModel.findById(sessionId);
            return !shouldApplyReplayRunResult({
              expectedSandboxId: startedSandboxId,
              currentSandboxId: current?.e2bSandboxId,
              sessionStatus: current?.status,
            });
          },
        });
        if (result.aborted) return;

        const current = await RuntimeSetupSessionModel.findById(sessionId);
        if (
          !shouldApplyReplayRunResult({
            expectedSandboxId: startedSandboxId,
            currentSandboxId: current?.e2bSandboxId,
            sessionStatus: current?.status,
          })
        ) {
          return;
        }
        if (!result.ok) {
          if (result.aborted) return;
          await destroySessionSandbox(
            sessionId,
            result.error || "Replay failed",
            startedSandboxId
          );
          return;
        }
        await RuntimeSetupSessionModel.findOneAndUpdate(
          { _id: sessionId, e2bSandboxId: startedSandboxId },
          {
            $set: {
              port: result.port,
              previewUrl: result.previewUrl,
              health: {
                ok: result.healthOk,
                summary: result.healthSummary,
                checkedAt: new Date(),
              },
              runPhase: "ready",
              error: null,
              status: "running",
              lastActiveAt: new Date(),
            },
          }
        );
        await persistLiveLogs(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLiveLog(sessionId, "system", `Replay failed: ${message}`);
        const current = await RuntimeSetupSessionModel.findById(sessionId);
        const expectedId = startedSandboxId || current?.e2bSandboxId || null;
        if (
          expectedId &&
          inFlightReplays.get(sid) === generation &&
          shouldApplyReplayRunResult({
            expectedSandboxId: expectedId,
            currentSandboxId: current?.e2bSandboxId,
            sessionStatus: current?.status,
          })
        ) {
          await destroySessionSandbox(sessionId, message, expectedId);
        }
      } finally {
        if (inFlightReplays.get(sid) === generation) {
          inFlightReplays.delete(sid);
        }
      }
    })();

    return replayPublicPayload(submission, session, { ok: true, accepted: true });
  });
}

export async function getReplayStatus(submissionId: string) {
  assertRuntimeSetupEnabled();
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) throw createHttpError(404, "Submission not found");
  const session = await RuntimeSetupSessionModel.findOne({
    submissionId: submission._id,
    kind: "replay",
  });
  if (session) {
    hydrateLiveFromSession(session as never);
    if (session.status === "running" || session.status === "provisioning") {
      session.lastActiveAt = new Date();
      await session.save();
    }
  }
  return replayPublicPayload(submission, session);
}

export async function getReplayLogs(submissionId: string, afterSeq = 0) {
  assertRuntimeSetupEnabled();
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) throw createHttpError(404, "Submission not found");
  const session = await RuntimeSetupSessionModel.findOne({
    submissionId: submission._id,
    kind: "replay",
  });
  if (!session) return { lines: [], nextSeq: 0 };
  hydrateLiveFromSession(session as never);
  setLiveSecrets(
    session._id.toString(),
    secretValues(submission.runtimeConfig as RuntimeConfig)
  );
  const lines = getLiveLogs(session._id.toString(), afterSeq);
  const nextSeq = lines.length > 0 ? lines[lines.length - 1].seq : afterSeq;
  return { lines, nextSeq };
}

export async function stopReplay(submissionId: string) {
  assertRuntimeSetupEnabled();
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) throw createHttpError(404, "Submission not found");
  const sid = submission._id.toString();

  return withSubmissionLock(replayLockKey(sid), async () => {
    inFlightReplays.delete(sid);
    const session = await RuntimeSetupSessionModel.findOne({
      submissionId: submission._id,
      kind: "replay",
    });
    if (!session) {
      return { stopped: true, session: null };
    }
    if (session.status !== "dead" || session.e2bSandboxId) {
      await destroySessionSandbox(session._id.toString(), "Stopped");
    }
    dropLiveLogs(session._id.toString());
    const latest = await RuntimeSetupSessionModel.findById(session._id);
    return {
      stopped: true,
      session: latest ? sessionPublic(latest as never) : null,
    };
  });
}

export { touchSession, countRunningSandboxes };
