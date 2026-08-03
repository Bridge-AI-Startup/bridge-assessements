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

export async function sendClaudeMessage(
  sessionId: string,
  prompt: string,
  opts?: { model?: string; effort?: string | null },
): Promise<
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
