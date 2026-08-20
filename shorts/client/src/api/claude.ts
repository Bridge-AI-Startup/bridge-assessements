import {
  get,
  getRequestErrorMessage,
  getResponseErrorMessage,
  post,
  readJsonBody,
} from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";

export type SessionUsage = {
  tokensUsed: number;
  tokenBudget: number;
  llmCalls: number;
  remaining: number;
  exhausted: boolean;
  /** Split of `tokensUsed`; both 0 on sessions that predate the split. */
  inputTokens?: number;
  outputTokens?: number;
};

export async function fetchSessionUsage(
  sessionId: string,
): Promise<SessionUsage | null> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const qs = new URLSearchParams({ anonymousId });
    const res = await get(
      `/session/${encodeURIComponent(sessionId)}/usage?${qs}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as SessionUsage;
  } catch {
    return null;
  }
}

export type ClaudeMessageResult = {
  output: string;
  exitCode: number;
  /** Serverless: did this turn rebuild the app? null on the E2B path. */
  workspaceChanged: boolean | null;
  usage: SessionUsage | null;
};

export type ClaudeTurn = {
  id: string;
  status: "running" | "completed" | "failed";
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  output?: string;
  workspaceChanged?: boolean | null;
  model?: string;
  effort?: string | null;
  usage?: SessionUsage | null;
};

const TURN_POLL_MS = 2_000;
const TURN_WAIT_MS = 330_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startClaudeTurn(
  sessionId: string,
  prompt: string,
  opts?: { model?: string; effort?: string | null },
): Promise<
  | { status: "started"; turnId: string }
  | { status: "ok"; result: ClaudeMessageResult }
  | { status: "error"; message: string; httpStatus?: number }
> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const res = await post(
      `/session/${encodeURIComponent(sessionId)}/claude/message`,
      {
        anonymousId,
        prompt,
        ...(opts?.model ? { model: opts.model } : {}),
        ...(opts?.effort ? { effort: opts.effort } : {}),
      },
    );
    const body = await readJsonBody(res);
    if (!res.ok) {
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status, ["error"]),
        httpStatus: res.status,
      };
    }
    // New async contract.
    if (body.turnId && (res.status === 202 || body.status === "running")) {
      return { status: "started", turnId: String(body.turnId) };
    }
    // Rolling-deploy fallback: an old instance still returns the finished turn.
    return {
      status: "ok",
      result: {
        output: String(body.output || ""),
        exitCode: Number(body.exitCode ?? 0),
        workspaceChanged:
          typeof body.workspaceChanged === "boolean"
            ? body.workspaceChanged
            : null,
        usage: body.usage || null,
      },
    };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}

export async function fetchClaudeTurn(
  sessionId: string,
  turnId: string,
): Promise<
  | { status: "ok"; turn: ClaudeTurn }
  | { status: "error"; message: string; httpStatus?: number }
> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const qs = new URLSearchParams({ anonymousId });
    const res = await get(
      `/session/${encodeURIComponent(sessionId)}/turn/${encodeURIComponent(turnId)}?${qs}`,
    );
    const body = await readJsonBody(res);
    if (!res.ok) {
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status, ["error"]),
        httpStatus: res.status,
      };
    }
    return { status: "ok", turn: body as ClaudeTurn };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}

export async function waitForClaudeTurn(
  sessionId: string,
  turnId: string,
): Promise<
  | { status: "ok"; result: ClaudeMessageResult }
  | { status: "error"; message: string; httpStatus?: number }
> {
  const deadline = Date.now() + TURN_WAIT_MS;
  while (Date.now() < deadline) {
    const fetched = await fetchClaudeTurn(sessionId, turnId);
    if (fetched.status === "ok") {
      if (fetched.turn.status === "completed") {
        return {
          status: "ok",
          result: {
            output: fetched.turn.output || "(No output)",
            exitCode: 0,
            workspaceChanged:
              typeof fetched.turn.workspaceChanged === "boolean"
                ? fetched.turn.workspaceChanged
                : null,
            usage: fetched.turn.usage || null,
          },
        };
      }
      if (fetched.turn.status === "failed") {
        return {
          status: "error",
          message:
            fetched.turn.error ||
            "That build didn't come through. Try it again.",
          httpStatus: 502,
        };
      }
    }
    await sleep(TURN_POLL_MS);
  }
  return {
    status: "error",
    message:
      "That build took too long, so I stopped waiting. Your current build is safe — try a smaller change.",
    httpStatus: 504,
  };
}

export async function sendClaudeMessage(
  sessionId: string,
  prompt: string,
  opts?: { model?: string; effort?: string | null },
): Promise<
  | { status: "ok"; result: ClaudeMessageResult }
  | { status: "error"; message: string; httpStatus?: number }
> {
  const started = await startClaudeTurn(sessionId, prompt, opts);
  if (started.status === "error") return started;
  if (started.status === "ok") return started;
  return waitForClaudeTurn(sessionId, started.turnId);
}
