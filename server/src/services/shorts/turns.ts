/**
 * Durable, async Shorts turns.
 *
 * POST /claude/message claims a lock on the session document, starts the
 * Anthropic/E2B work without holding the HTTP request, and returns a turn id.
 * The client polls GET /session/:id/turn/:turnId (or reads `currentTurn` on
 * the session) until the turn completes. The lock lives in Mongo so a second
 * Render instance cannot start a colliding turn.
 *
 * Generation still runs in this process — there is no separate worker.
 */
import { randomUUID } from "node:crypto";
import createHttpError, { isHttpError } from "http-errors";
import { Types } from "mongoose";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import { getSessionUsage, runClaudePrintPrompt } from "./llmProxy.js";
import {
  getSessionMakeMode,
  runServerlessMakeTurn,
} from "./serverlessMake.js";

export const TURN_STATUSES = ["running", "completed", "failed"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

/**
 * Longer than the slowest make path (E2B claude -p is 10 min; serverless
 * aborts at 5). Only used to unstick a lock after a process crash.
 */
export const TURN_STALE_MS = 11 * 60 * 1000;

export type SessionTurn = {
  id: string;
  status: TurnStatus;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  output?: string;
  workspaceChanged?: boolean | null;
  model?: string;
  effort?: string | null;
};

export type StartTurnInput = {
  sessionId: string;
  anonymousId: string;
  prompt: string;
  model?: string;
  effort?: string;
};

export type StartTurnResult = {
  turnId: string;
  status: "running";
};

type CurrentTurnDoc = {
  id?: string;
  status?: TurnStatus;
  prompt?: string;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  output?: string;
  workspaceChanged?: boolean | null;
  model?: string;
  effort?: string | null;
};

export function isTurnStale(
  startedAt: Date | string | undefined,
  now: number = Date.now(),
): boolean {
  if (!startedAt) return false;
  const t = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > TURN_STALE_MS;
}

export function serializeCurrentTurn(
  raw: CurrentTurnDoc | null | undefined,
): SessionTurn | null {
  if (!raw?.id || !raw.status || !raw.prompt || !raw.startedAt) return null;
  const startedAt =
    raw.startedAt instanceof Date
      ? raw.startedAt.toISOString()
      : new Date(raw.startedAt).toISOString();
  const turn: SessionTurn = {
    id: raw.id,
    status: raw.status,
    prompt: raw.prompt,
    startedAt,
  };
  if (raw.finishedAt) {
    turn.finishedAt =
      raw.finishedAt instanceof Date
        ? raw.finishedAt.toISOString()
        : new Date(raw.finishedAt).toISOString();
  }
  if (raw.error) turn.error = raw.error;
  if (typeof raw.output === "string") turn.output = raw.output;
  if (raw.workspaceChanged !== undefined) {
    turn.workspaceChanged = raw.workspaceChanged;
  }
  if (raw.model) turn.model = raw.model;
  if (raw.effort !== undefined) turn.effort = raw.effort;
  return turn;
}

export async function reapStaleTurn(sessionId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;
  const BuildSession = getPlayBuildSessionModel();
  const cutoff = new Date(Date.now() - TURN_STALE_MS);
  const result = await BuildSession.updateOne(
    {
      _id: sessionId,
      "currentTurn.status": "running",
      "currentTurn.startedAt": { $lte: cutoff },
    },
    {
      $set: {
        "currentTurn.status": "failed",
        "currentTurn.finishedAt": new Date(),
        "currentTurn.error":
          "That build got stuck, so I stopped it. Send it again.",
      },
    },
  );
  return (result.modifiedCount ?? 0) > 0;
}

async function claimTurn(input: {
  sessionId: string;
  anonymousId: string;
  prompt: string;
}): Promise<{ turnId: string } | { existing: SessionTurn }> {
  const BuildSession = getPlayBuildSessionModel();
  await reapStaleTurn(input.sessionId);

  const turnId = randomUUID();
  const startedAt = new Date();
  const claimed = await BuildSession.findOneAndUpdate(
    {
      _id: input.sessionId,
      anonymousId: input.anonymousId.trim(),
      status: "active",
      $or: [
        { currentTurn: { $exists: false } },
        { currentTurn: null },
        { "currentTurn.status": { $ne: "running" } },
      ],
    },
    {
      $set: {
        currentTurn: {
          id: turnId,
          status: "running",
          prompt: input.prompt,
          startedAt,
        },
      },
    },
    { new: true },
  );

  if (claimed) return { turnId };

  const doc = await BuildSession.findById(input.sessionId)
    .select("anonymousId currentTurn")
    .lean();
  const existing = serializeCurrentTurn(
    (doc as { currentTurn?: CurrentTurnDoc } | null)?.currentTurn,
  );
  if (
    existing?.status === "running" &&
    existing.prompt === input.prompt &&
    (doc as { anonymousId?: string } | null)?.anonymousId ===
      input.anonymousId.trim()
  ) {
    return { existing };
  }
  throw createHttpError(409, "A build is already running for this session");
}

async function finishTurn(
  sessionId: string,
  turnId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const BuildSession = getPlayBuildSessionModel();
  await BuildSession.updateOne(
    { _id: sessionId, "currentTurn.id": turnId, "currentTurn.status": "running" },
    { $set: patch },
  );
}

function publicTurnError(err: unknown): string {
  if (isHttpError(err)) return err.message;
  if (err instanceof Error && err.message.trim()) {
    // Don't leak Node fetch internals to the builder.
    if (/aborted due to timeout|fetch failed/i.test(err.message)) {
      return "That build took too long, so I stopped it. Try a smaller change and send it again.";
    }
    return err.message;
  }
  return "That build didn't come through. Try it again.";
}

async function executeClaimedTurn(input: StartTurnInput & { turnId: string }) {
  try {
    const makeMode = await getSessionMakeMode(input.sessionId);
    const result =
      makeMode === "serverless"
        ? await runServerlessMakeTurn(input)
        : await runClaudePrintPrompt(input);
    const workspaceChanged =
      "workspaceChanged" in result ? result.workspaceChanged : null;
    await finishTurn(input.sessionId, input.turnId, {
      "currentTurn.status": "completed",
      "currentTurn.finishedAt": new Date(),
      "currentTurn.output": result.output,
      "currentTurn.workspaceChanged": workspaceChanged,
      "currentTurn.model": result.model,
      "currentTurn.effort": result.effort,
      "currentTurn.error": undefined,
    });
  } catch (err) {
    const message = publicTurnError(err);
    console.warn(
      `[shorts turns] turn_failed ${JSON.stringify({
        sessionId: input.sessionId,
        turnId: input.turnId,
        message,
      })}`,
    );
    try {
      await finishTurn(input.sessionId, input.turnId, {
        "currentTurn.status": "failed",
        "currentTurn.finishedAt": new Date(),
        "currentTurn.error": message,
      });
    } catch (finishErr) {
      console.warn(
        "[shorts turns] failed to record turn failure:",
        finishErr instanceof Error ? finishErr.message : finishErr,
      );
    }
  }
}

export async function startSessionTurn(
  input: StartTurnInput,
): Promise<StartTurnResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw createHttpError(400, "prompt is required");
  if (prompt.length > 20_000) throw createHttpError(400, "prompt too long");
  if (!Types.ObjectId.isValid(input.sessionId)) {
    throw createHttpError(400, "invalid session id");
  }

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(input.sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== input.anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status !== "active") {
    throw createHttpError(400, "session_not_active");
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    doc.status = "expired";
    await doc.save();
    throw createHttpError(400, "session_expired");
  }
  if ((doc.tokensUsed ?? 0) >= doc.tokenBudget) {
    throw createHttpError(429, "token_budget_exceeded");
  }

  const claimed = await claimTurn({
    sessionId: input.sessionId,
    anonymousId: input.anonymousId,
    prompt,
  });
  if ("existing" in claimed) {
    return { turnId: claimed.existing.id, status: "running" };
  }

  void executeClaimedTurn({ ...input, prompt, turnId: claimed.turnId });
  return { turnId: claimed.turnId, status: "running" };
}

export async function getSessionTurn(
  sessionId: string,
  turnId: string,
  anonymousId: string,
): Promise<SessionTurn & { usage?: Awaited<ReturnType<typeof getSessionUsage>> | null }> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw createHttpError(400, "invalid session id");
  }
  await reapStaleTurn(sessionId);

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId)
    .select("anonymousId currentTurn")
    .lean();
  if (!doc) throw createHttpError(404, "session_not_found");
  if ((doc as { anonymousId?: string }).anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  const turn = serializeCurrentTurn(
    (doc as { currentTurn?: CurrentTurnDoc }).currentTurn,
  );
  if (!turn || turn.id !== turnId) {
    throw createHttpError(404, "turn_not_found");
  }

  let usage = null;
  if (turn.status === "completed") {
    try {
      usage = await getSessionUsage(sessionId, anonymousId);
    } catch {
      usage = null;
    }
  }
  return { ...turn, usage };
}
