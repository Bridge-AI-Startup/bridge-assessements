import createHttpError from "http-errors";
import { Sandbox } from "e2b";
import {
  getShortsMakeMode,
  getShortsMaxConcurrentSessions,
} from "../../utils/shortsEnv.js";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import {
  buildSessionPreviewUrl,
  provisionServerlessSession,
} from "./serverlessMake.js";
import {
  getChallengeBySlug,
  getCurrentChallenge,
  type PublicChallenge,
} from "./challenges.js";
import {
  createPlaySandbox,
  connectPlaySandbox,
  getPlaySandboxUrls,
  getWorkspaceRevision,
  killPlaySandbox,
  pausePlaySandbox,
  runPlayCommand,
  writeChallengeMarkdown,
} from "./sandbox.js";
import { provisionClaudeForSession } from "./claudeProvision.js";
import { generateLlmProxyToken } from "./llmProxy.js";
import {
  e2bTimeoutMsForChallengeDay,
  restoreSessionSnapshotAndPrompt,
  serializeChatMessages,
  type SnapshotFile,
} from "./sessionPersist.js";
import { createKeyedAsyncLock } from "./keyedAsyncLock.js";
import {
  reapStaleTurn,
  serializeCurrentTurn,
  type SessionTurn,
} from "./turns.js";
import { starterWorkspaceSnapshot } from "./starterDetection.js";

export const MAX_RESTARTS_PER_BUILD = 1;
export const RESTART_LIMIT_CODE = "restart_limit" as const;
export const RESTART_LIMIT_MESSAGE =
  "You already used your one restart for this build.";

export class RestartLimitError extends Error {
  readonly statusCode = 409;
  readonly code = RESTART_LIMIT_CODE;

  constructor() {
    super(RESTART_LIMIT_MESSAGE);
    this.name = "RestartLimitError";
  }
}

export function isRestartLimitError(err: unknown): err is RestartLimitError {
  return err instanceof RestartLimitError;
}

/**
 * Serverless previews are served by this backend, so their URL is only valid
 * while the public base URL is unchanged. Re-stamp it on every resume: a
 * session started behind a tunnel that has since died (or moved) otherwise
 * keeps handing the browser an unreachable iframe origin forever.
 */
async function syncServerlessPreviewUrl(
  doc: { previewUrl?: string; _id: unknown; save: () => Promise<unknown> },
  anonymousId: string,
): Promise<void> {
  const fresh = buildSessionPreviewUrl(String(doc._id), anonymousId);
  if (doc.previewUrl === fresh) return;
  doc.previewUrl = fresh;
  await doc.save();
}

export type SessionChallengeSummary = {
  slug: string;
  title: string;
  challengeDate: string;
  tokenBudget: number;
};

export type SessionChatMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

export type SessionResponse = {
  sessionId: string;
  status: string;
  makeMode: "e2b" | "serverless";
  previewUrl?: string;
  expiresAt?: string;
  startedAt?: string;
  challenge: SessionChallengeSummary;
  tokensUsed?: number;
  tokenBudget?: number;
  /** Split of `tokensUsed`; both 0 on sessions that predate the split. */
  inputTokensUsed?: number;
  outputTokensUsed?: number;
  chatMessages?: SessionChatMessage[];
  sandboxPaused?: boolean;
  error?: string;
  currentTurn?: SessionTurn | null;
  restartsUsed?: number;
  restartsRemaining?: number;
};

function getMaxConcurrentSessions(): number {
  const raw = getShortsMaxConcurrentSessions();
  const n = raw ? parseInt(raw, 10) : 5;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export type SessionQueueInfo = {
  code: "session_queue";
  activeCount: number;
  maxConcurrent: number;
  /** Rough seconds until the soonest running session's expiresAt (or a floor). */
  estimatedWaitSeconds: number;
};

export class SessionQueueError extends Error {
  readonly statusCode = 503;
  readonly code = "session_queue" as const;
  readonly activeCount: number;
  readonly maxConcurrent: number;
  readonly estimatedWaitSeconds: number;

  constructor(info: Omit<SessionQueueInfo, "code">) {
    super("session_queue");
    this.name = "SessionQueueError";
    this.activeCount = info.activeCount;
    this.maxConcurrent = info.maxConcurrent;
    this.estimatedWaitSeconds = info.estimatedWaitSeconds;
  }

  toJSON(): SessionQueueInfo {
    return {
      code: "session_queue",
      activeCount: this.activeCount,
      maxConcurrent: this.maxConcurrent,
      estimatedWaitSeconds: this.estimatedWaitSeconds,
    };
  }
}

export function isSessionQueueError(err: unknown): err is SessionQueueError {
  return err instanceof SessionQueueError;
}

/**
 * Rough wait for a Build seat.
 *
 * There is no per-build or calendar clock. Seats free when someone submits,
 * leaves and pauses, or an admin activates another round. That is unknowable,
 * so this remains a flat estimate rather than fake precision.
 */
const ESTIMATED_QUEUE_WAIT_SECONDS = 90;

function toSessionResponse(
  doc: {
    _id: { toString(): string };
    status: string;
    makeMode?: "e2b" | "serverless";
    previewUrl?: string;
    expiresAt?: Date;
    startedAt?: Date;
    error?: string;
    challengeSlug: string;
    challengeDate: string;
    tokenBudget: number;
    tokensUsed?: number;
    inputTokensUsed?: number;
    outputTokensUsed?: number;
    sandboxPaused?: boolean;
    chatMessages?: Array<{
      role: "user" | "assistant";
      text: string;
      createdAt?: Date;
    }>;
    currentTurn?: {
      id?: string;
      status?: "running" | "completed" | "failed";
      prompt?: string;
      startedAt?: Date;
      finishedAt?: Date;
      error?: string;
      output?: string;
      workspaceChanged?: boolean | null;
      model?: string;
      effort?: string | null;
    } | null;
    restartsUsed?: number;
  },
  challenge: PublicChallenge | SessionChallengeSummary,
): SessionResponse {
  const result: SessionResponse = {
    sessionId: doc._id.toString(),
    status: doc.status,
    // Absent on legacy docs → E2B. The client branches its Build UI off this.
    makeMode: doc.makeMode === "serverless" ? "serverless" : "e2b",
    challenge: {
      slug: challenge.slug,
      title: challenge.title,
      challengeDate: challenge.challengeDate,
      tokenBudget: challenge.tokenBudget,
    },
    tokensUsed: doc.tokensUsed ?? 0,
    tokenBudget: doc.tokenBudget,
    inputTokensUsed: doc.inputTokensUsed ?? 0,
    outputTokensUsed: doc.outputTokensUsed ?? 0,
    chatMessages: serializeChatMessages(doc.chatMessages),
    sandboxPaused: Boolean(doc.sandboxPaused),
    restartsUsed: doc.restartsUsed ?? 0,
    restartsRemaining: Math.max(
      0,
      MAX_RESTARTS_PER_BUILD - (doc.restartsUsed ?? 0),
    ),
  };
  if (doc.previewUrl) result.previewUrl = doc.previewUrl;
  if (doc.expiresAt) result.expiresAt = doc.expiresAt.toISOString();
  if (doc.startedAt) result.startedAt = doc.startedAt.toISOString();
  if (doc.error) result.error = doc.error;
  const currentTurn = serializeCurrentTurn(doc.currentTurn);
  if (currentTurn) result.currentTurn = currentTurn;
  return result;
}

function toChallengeSummary(
  challenge: PublicChallenge,
): SessionChallengeSummary {
  return {
    slug: challenge.slug,
    title: challenge.title,
    challengeDate: challenge.challengeDate,
    tokenBudget: challenge.tokenBudget,
  };
}

function fallbackChallengeSummary(doc: {
  challengeSlug: string;
  challengeDate: string;
  tokenBudget: number;
}): SessionChallengeSummary {
  return {
    slug: doc.challengeSlug,
    title: doc.challengeSlug,
    challengeDate: doc.challengeDate,
    tokenBudget: doc.tokenBudget,
  };
}

async function isSandboxAlive(e2bSandboxId: string): Promise<boolean> {
  try {
    // connect() auto-resumes paused sandboxes and resets TTL
    const sandbox = await connectPlaySandbox(e2bSandboxId, {
      timeoutMs: e2bTimeoutMsForChallengeDay("1970-01-01"),
    });
    const probe = await runPlayCommand(sandbox, "echo ok", { timeoutMs: 8_000 });
    return probe.exitCode === 0 && (probe.stdout || "").includes("ok");
  } catch {
    return false;
  }
}

async function expireSession(
  doc: {
    status: string;
    error?: string;
    e2bSandboxId?: string;
    sandboxPaused?: boolean;
    save: () => Promise<unknown>;
  },
  reason: string,
): Promise<void> {
  if (doc.e2bSandboxId) {
    try {
      const sandbox = await connectPlaySandbox(doc.e2bSandboxId, {
        timeoutMs: 60_000,
      });
      await killPlaySandbox(sandbox);
    } catch {
      try {
        await Sandbox.kill(doc.e2bSandboxId);
      } catch {
        /* already gone */
      }
    }
  }
  doc.status = "expired";
  doc.error = reason;
  doc.sandboxPaused = false;
  await doc.save();
}

/** Kill old box if any, create a fresh sandbox on the same session document. */
async function reprovisionSandboxOnSession(
  doc: {
    _id: { toString(): string };
    e2bSandboxId?: string;
    llmProxyToken?: string;
    challengeSlug: string;
    challengeDate: string;
    status: string;
    previewUrl?: string;
    error?: string;
    expiresAt?: Date;
    workspaceSnapshot?: SnapshotFile[];
    save: () => Promise<unknown>;
  },
  challenge: PublicChallenge,
  anonymousId: string,
): Promise<void> {
  if (doc.e2bSandboxId) {
    try {
      const old = await connectPlaySandbox(doc.e2bSandboxId);
      await killPlaySandbox(old);
    } catch {
      // ignore — box may already be gone
    }
  }

  if (!doc.llmProxyToken) {
    doc.llmProxyToken = generateLlmProxyToken();
  }

  const timeoutMs = e2bTimeoutMsForChallengeDay(challenge.challengeDate);
  const sandbox = await createPlaySandbox({
    timeoutMs,
    metadata: {
      sessionId: doc._id.toString(),
      challengeSlug: challenge.slug,
      anonymousId,
    },
  });

  await restoreSessionSnapshotAndPrompt(sandbox, {
    files: doc.workspaceSnapshot as SnapshotFile[] | undefined,
    challengeTitle: challenge.title,
    challengePrompt: challenge.prompt,
  });

  await provisionClaudeForSession(sandbox, {
    sessionId: doc._id.toString(),
    llmProxyToken: doc.llmProxyToken!,
  });

  const readyProbe = await runPlayCommand(sandbox, "echo play-ready", {
    timeoutMs: 15_000,
  });
  if (
    readyProbe.exitCode !== 0 ||
    !(readyProbe.stdout || "").includes("play-ready")
  ) {
    throw new Error("Sandbox started but is not responding to commands");
  }

  const urls = getPlaySandboxUrls(sandbox);
  doc.status = "active";
  doc.e2bSandboxId = sandbox.sandboxId;
  doc.previewUrl = urls.previewUrl;
  doc.error = undefined;
  (doc as { sandboxPaused?: boolean }).sandboxPaused = false;
  await doc.save();
}

// Session creation is serialized because React StrictMode can issue duplicate POSTs.
const withAnonymousSessionLock = createKeyedAsyncLock();

/**
 * Create a build session for the explicit current round, or resume one for the
 * same anonymousId + challengeDate.
 */
export async function createOrResumeSession(input: {
  anonymousId: string;
}): Promise<SessionResponse> {
  const anonymousId = input.anonymousId.trim();
  if (!anonymousId) {
    throw createHttpError(400, "anonymousId is required");
  }

  return withAnonymousSessionLock(anonymousId, () =>
    createOrResumeSessionUnlocked(anonymousId),
  );
}

async function createOrResumeSessionUnlocked(
  anonymousId: string,
): Promise<SessionResponse> {
  const challenge = await getCurrentChallenge();
  if (!challenge) {
    throw createHttpError(404, "no_active_round");
  }

  const BuildSession = getPlayBuildSessionModel();
  const now = new Date();

  // Wait briefly if another request is mid-provision for this user/round.
  for (let i = 0; i < 60; i++) {
    const provisioning = await BuildSession.findOne({
      anonymousId,
      challengeDate: challenge.challengeDate,
      status: "provisioning",
    });
    if (!provisioning) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  let existing = await BuildSession.findOne({
    anonymousId,
    challengeDate: challenge.challengeDate,
    status: "active",
  });

  if (existing) {
    // Legacy sessions may carry a calendar-derived expiry. The active round is
    // now manual, so clear it rather than letting a date close the build.
    if (existing.expiresAt) {
      existing.expiresAt = undefined;
      await existing.save();
    }
  }

  if (existing) {
    // Serverless sessions have no sandbox to revive — just refresh preview + return.
    if (existing.makeMode === "serverless") {
      await syncServerlessPreviewUrl(existing, anonymousId);
      return toSessionResponse(existing, challenge);
    }
    if (existing.e2bSandboxId) {
      const alive = await isSandboxAlive(existing.e2bSandboxId);
      if (alive) {
        try {
          const sandbox = await connectPlaySandbox(existing.e2bSandboxId, {
            timeoutMs: e2bTimeoutMsForChallengeDay(challenge.challengeDate),
          });
          if (!existing.llmProxyToken) {
            existing.llmProxyToken = generateLlmProxyToken();
            await existing.save();
          }
          await provisionClaudeForSession(sandbox, {
            sessionId: existing._id.toString(),
            llmProxyToken: existing.llmProxyToken,
          });
          const urls = getPlaySandboxUrls(sandbox);
          existing.previewUrl = urls.previewUrl;
          existing.sandboxPaused = false;
          existing.error = undefined;
          await existing.save();
          return toSessionResponse(existing, challenge);
        } catch (err) {
          console.warn(
            "[play/sessions] resume refresh failed; recreating sandbox in place:",
            err,
          );
        }
      }
    }

    // Sandbox dead or refresh failed — keep Mongo session (chat + snapshot), new box
    try {
      await reprovisionSandboxOnSession(existing, challenge, anonymousId);
      return toSessionResponse(existing, challenge);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to recreate sandbox";
      console.warn("[play/sessions] in-place reprovision failed:", message);
      await expireSession(existing, "Sandbox no longer reachable");
    }
  }

  // Only expire other *active* sessions for this user/day (never wipe in-flight
  // provisioning — that raced with React double-mount and killed fresh boxes).
  await BuildSession.updateMany(
    {
      anonymousId,
      challengeDate: challenge.challengeDate,
      status: "active",
    },
    {
      $set: {
        status: "expired",
        error: "Replaced by new session",
      },
    },
  );

  // Serverless make mode: no sandbox, no concurrency ceiling. Create the session
  // active immediately with a server-hosted previewUrl and return.
  // Per-challenge override (set by admins) wins; else the server env default.
  const resolvedMakeMode = challenge.makeMode ?? getShortsMakeMode();
  if (resolvedMakeMode === "serverless") {
    const doc = await provisionServerlessSession({
      anonymousId,
      challenge,
      startedAt: now,
    });
    return toSessionResponse(doc, challenge);
  }

  // Paused builders park their sandbox but should not block newcomers.
  const activeCount = await BuildSession.countDocuments({
    status: "active",
    sandboxPaused: { $ne: true },
  });
  const maxConcurrent = getMaxConcurrentSessions();
  if (activeCount >= maxConcurrent) {
    throw new SessionQueueError({
      activeCount,
      maxConcurrent,
      estimatedWaitSeconds: ESTIMATED_QUEUE_WAIT_SECONDS,
    });
  }

  const timeoutMs = e2bTimeoutMsForChallengeDay(challenge.challengeDate, now);

  const doc = await BuildSession.create({
    anonymousId,
    challengeSlug: challenge.slug,
    challengeDate: challenge.challengeDate,
    status: "provisioning",
    tokenBudget: challenge.tokenBudget,
    tokensUsed: 0,
    llmProxyToken: generateLlmProxyToken(),
    llmCalls: 0,
    startedAt: now,
    chatMessages: [],
    workspaceSnapshot: [],
  });

  try {
    const sandbox = await createPlaySandbox({
      timeoutMs,
      metadata: {
        sessionId: doc._id.toString(),
        challengeSlug: challenge.slug,
        anonymousId,
      },
    });

    const challengeMd = `# ${challenge.title}\n\n${challenge.prompt}\n`;
    await writeChallengeMarkdown(sandbox, challengeMd);
    await provisionClaudeForSession(sandbox, {
      sessionId: doc._id.toString(),
      llmProxyToken: doc.llmProxyToken!,
    });

    const readyProbe = await runPlayCommand(sandbox, "echo play-ready", {
      timeoutMs: 15_000,
    });
    if (
      readyProbe.exitCode !== 0 ||
      !(readyProbe.stdout || "").includes("play-ready")
    ) {
      throw new Error("Sandbox started but is not responding to commands");
    }

    const urls = getPlaySandboxUrls(sandbox);

    doc.status = "active";
    doc.e2bSandboxId = sandbox.sandboxId;
    doc.previewUrl = urls.previewUrl;
    doc.error = undefined;
    doc.sandboxPaused = false;
    await doc.save();

    return toSessionResponse(doc, challenge);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create sandbox";
    doc.status = "failed";
    doc.error = message;
    await doc.save();

    if (doc.e2bSandboxId) {
      try {
        const sandbox = await connectPlaySandbox(doc.e2bSandboxId);
        await killPlaySandbox(sandbox);
      } catch {
        // ignore cleanup errors
      }
    }

    throw createHttpError(502, message);
  }
}

export async function getSession(
  sessionId: string,
  anonymousId: string,
): Promise<SessionResponse> {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) {
    throw createHttpError(404, "session_not_found");
  }
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }

  await reapStaleTurn(sessionId);
  const live = (await BuildSession.findById(sessionId)) || doc;

  if (
    live.status === "active" &&
    live.expiresAt &&
    live.expiresAt.getTime() <= Date.now()
  ) {
    live.status = "expired";
    await live.save();
  }

  const bySlug = await getChallengeBySlug(live.challengeSlug);
  if (bySlug) {
    return toSessionResponse(live, toChallengeSummary(bySlug));
  }

  return toSessionResponse(live, fallbackChallengeSummary(live));
}

/**
 * Fingerprint of sandbox project files for preview refresh-on-save.
 */
export async function getSessionWorkspaceRevision(
  sessionId: string,
  anonymousId: string,
): Promise<{ revision: string }> {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) {
    throw createHttpError(404, "session_not_found");
  }
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  // Serverless has no sandbox to fingerprint — derive a revision from the last
  // snapshot write. (The client skips this poll in serverless mode.)
  if (doc.makeMode === "serverless") {
    const ts =
      doc.workspaceSnapshotAt instanceof Date
        ? doc.workspaceSnapshotAt.getTime()
        : 0;
    return { revision: String(ts) };
  }
  if (doc.status !== "active" || !doc.e2bSandboxId) {
    throw createHttpError(400, "session_not_active");
  }

  let sandbox: Sandbox;
  try {
    sandbox = await connectPlaySandbox(doc.e2bSandboxId, {
      timeoutMs: e2bTimeoutMsForChallengeDay(doc.challengeDate),
    });
  } catch {
    doc.status = "expired";
    doc.error = "Sandbox no longer reachable";
    await doc.save().catch(() => undefined);
    throw createHttpError(502, "Sandbox no longer reachable");
  }

  const revision = await getWorkspaceRevision(sandbox);
  return { revision };
}

async function loadOwnedActiveSession(sessionId: string, anonymousId: string) {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status !== "active") {
    throw createHttpError(400, "session_not_active");
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    await expireSession(doc, "Challenge round ended");
    throw createHttpError(400, "session_expired");
  }
  // Serverless sessions never have a sandbox; only E2B sessions require one.
  if (doc.makeMode !== "serverless" && !doc.e2bSandboxId) {
    throw createHttpError(400, "session_not_active");
  }
  return doc;
}

/**
 * Abandon an in-progress build: kill the E2B sandbox (if any) and mark the
 * session expired so it frees a concurrent seat. Serverless sessions only need
 * the status flip. Idempotent when already expired/failed.
 */
export async function cancelPlayBuildSession(
  sessionId: string,
  anonymousId: string,
): Promise<{ cancelled: boolean }> {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status === "submitted") {
    throw createHttpError(400, "session_already_submitted");
  }
  if (doc.status === "expired" || doc.status === "failed") {
    return { cancelled: true };
  }
  // Unlike pause, cancel always tears down — even mid-turn — so the seat frees.
  await expireSession(doc, "Cancelled by user");
  return { cancelled: true };
}

/**
 * Reset an active build to the starter once per session: clear chat, wipe the
 * workspace, and reprovision the sandbox (E2B) or refresh the serverless preview.
 */
export async function restartPlayBuildSession(
  sessionId: string,
  anonymousId: string,
): Promise<SessionResponse> {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status === "submitted") {
    throw createHttpError(400, "session_already_submitted");
  }
  if (doc.status !== "active") {
    throw createHttpError(400, "session_not_active");
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    await expireSession(doc, "Challenge round ended");
    throw createHttpError(400, "session_expired");
  }

  await reapStaleTurn(sessionId);
  const live = (await BuildSession.findById(sessionId)) || doc;
  if (live.currentTurn?.status === "running") {
    throw createHttpError(409, "turn_running");
  }

  const restartsUsed = live.restartsUsed ?? 0;
  if (restartsUsed >= MAX_RESTARTS_PER_BUILD) {
    throw new RestartLimitError();
  }

  const makeMode = live.makeMode === "serverless" ? "serverless" : "e2b";
  const starterFiles = starterWorkspaceSnapshot(makeMode);
  live.workspaceSnapshot = starterFiles;
  live.workspaceSnapshotAt = new Date();
  live.chatMessages = [];
  live.set("currentTurn", undefined);
  live.restartsUsed = restartsUsed + 1;
  live.error = undefined;
  await live.save();

  const bySlug = await getChallengeBySlug(live.challengeSlug);
  const challenge = bySlug
    ? toChallengeSummary(bySlug)
    : fallbackChallengeSummary(live);

  if (makeMode === "serverless") {
    await syncServerlessPreviewUrl(live, anonymousId);
    return toSessionResponse(live, challenge);
  }

  const challengeForSandbox: PublicChallenge =
    bySlug ??
    ({
      slug: live.challengeSlug,
      title: live.challengeSlug,
      challengeDate: live.challengeDate,
      tokenBudget: live.tokenBudget,
      prompt: "",
      category: "other",
    } satisfies PublicChallenge);
  await reprovisionSandboxOnSession(live, challengeForSandbox, anonymousId);
  return toSessionResponse(live, challenge);
}

/**
 * Pause the E2B sandbox while the user leaves Build. Session stays active in Mongo
 * until the challenge round ends; resume reconnects the same box.
 * Paused sessions do not count toward PLAY_MAX_CONCURRENT_SESSIONS.
 */
export async function pausePlayBuildSession(
  sessionId: string,
  anonymousId: string,
): Promise<{ paused: boolean; sandboxPaused: boolean }> {
  const doc = await loadOwnedActiveSession(sessionId, anonymousId);

  // Nothing to pause in serverless mode — session stays active until it expires.
  if (doc.makeMode === "serverless") {
    return { paused: true, sandboxPaused: false };
  }

  if (doc.sandboxPaused) {
    return { paused: true, sandboxPaused: true };
  }

  await reapStaleTurn(sessionId);
  const live = await getPlayBuildSessionModel().findById(sessionId);
  if (live?.currentTurn?.status === "running") {
    console.warn(
      `[play/sessions] skip pause while a turn is running session=${sessionId}`,
    );
    return { paused: false, sandboxPaused: false };
  }

  const ok = await pausePlaySandbox(doc.e2bSandboxId!);
  if (ok) {
    doc.sandboxPaused = true;
    await doc.save();
  }
  return { paused: ok, sandboxPaused: Boolean(doc.sandboxPaused) };
}

/**
 * Resume a paused sandbox (or keep-alive a running one) and refresh preview URLs.
 */
export async function resumePlayBuildSession(
  sessionId: string,
  anonymousId: string,
): Promise<SessionResponse> {
  const doc = await loadOwnedActiveSession(sessionId, anonymousId);

  // Serverless resume is a no-op keep-alive — refresh preview URL and return.
  if (doc.makeMode === "serverless") {
    await syncServerlessPreviewUrl(doc, anonymousId);
    const bySlugServerless = await getChallengeBySlug(doc.challengeSlug);
    return bySlugServerless
      ? toSessionResponse(doc, toChallengeSummary(bySlugServerless))
      : toSessionResponse(doc, fallbackChallengeSummary(doc));
  }

  const timeoutMs = e2bTimeoutMsForChallengeDay(doc.challengeDate);

  let sandbox: Sandbox;
  try {
    sandbox = await connectPlaySandbox(doc.e2bSandboxId!, { timeoutMs });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Sandbox no longer reachable";
    throw createHttpError(502, message);
  }

  if (!doc.llmProxyToken) {
    doc.llmProxyToken = generateLlmProxyToken();
  }
  await provisionClaudeForSession(sandbox, {
    sessionId: doc._id.toString(),
    llmProxyToken: doc.llmProxyToken,
  });

  const urls = getPlaySandboxUrls(sandbox);
  doc.previewUrl = urls.previewUrl;
  doc.sandboxPaused = false;
  doc.error = undefined;
  await doc.save();

  const bySlug = await getChallengeBySlug(doc.challengeSlug);
  if (bySlug) {
    return toSessionResponse(doc, toChallengeSummary(bySlug));
  }

  return toSessionResponse(doc, fallbackChallengeSummary(doc));
}
