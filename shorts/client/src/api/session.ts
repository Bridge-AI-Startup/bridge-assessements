import {
  get,
  getRequestErrorMessage,
  getResponseErrorMessage,
  post,
  readJsonBody,
} from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import { API_BASE_URL } from "@/config/api";

export type SessionChallenge = {
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

export type PlaySession = {
  sessionId: string;
  status: string;
  /** "serverless" = single-file HTML generation (no sandbox); default "e2b". */
  makeMode?: "e2b" | "serverless";
  previewUrl?: string;
  /** End of the challenge round. Builds have no per-session clock. */
  expiresAt?: string;
  startedAt?: string;
  challenge: SessionChallenge;
  tokensUsed?: number;
  tokenBudget?: number;
  /** Split of `tokensUsed`; both 0 on sessions that predate the split. */
  inputTokensUsed?: number;
  outputTokensUsed?: number;
  chatMessages?: SessionChatMessage[];
  sandboxPaused?: boolean;
  error?: string;
};

export type SessionQueueInfo = {
  code: "session_queue";
  activeCount: number;
  maxConcurrent: number;
  estimatedWaitSeconds: number;
};

export type SessionResult =
  | { status: "ok"; session: PlaySession }
  | { status: "queued"; queue: SessionQueueInfo }
  | { status: "error"; message: string; httpStatus?: number };

const SESSION_STORAGE_KEY = "playSessionId";

function storeSessionId(sessionId: string) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // ignore
  }
}

export function clearStoredSessionId() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function parseQueueBody(body: unknown): SessionQueueInfo | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.code !== "session_queue" && o.error !== "session_queue") return null;
  const activeCount = Number(o.activeCount);
  const maxConcurrent = Number(o.maxConcurrent);
  const estimatedWaitSeconds = Number(o.estimatedWaitSeconds);
  if (
    !Number.isFinite(activeCount) ||
    !Number.isFinite(maxConcurrent) ||
    !Number.isFinite(estimatedWaitSeconds)
  ) {
    return {
      code: "session_queue",
      activeCount: 0,
      maxConcurrent: 0,
      estimatedWaitSeconds: 45,
    };
  }
  return {
    code: "session_queue",
    activeCount,
    maxConcurrent,
    estimatedWaitSeconds,
  };
}

async function parseSessionResponse(res: Response): Promise<SessionResult> {
  const body = await readJsonBody(res);
  if (res.status === 503) {
    const queue = parseQueueBody(body);
    if (queue) {
      return { status: "queued", queue };
    }
  }
  if (!res.ok) {
    return {
      status: "error",
      message: getResponseErrorMessage(body, res.status),
      httpStatus: res.status,
    };
  }
  return { status: "ok", session: body as PlaySession };
}

function requestFailure(error: unknown): SessionResult {
  return {
    status: "error",
    message: getRequestErrorMessage(error),
  };
}

async function persistSuccessfulSession(
  response: Promise<Response>,
): Promise<SessionResult> {
  try {
    const result = await parseSessionResponse(await response);
    if (result.status === "ok") {
      storeSessionId(result.session.sessionId);
    }
    return result;
  } catch (error) {
    return requestFailure(error);
  }
}

async function createSession(): Promise<SessionResult> {
  const anonymousId = getOrCreateAnonymousId();
  return persistSuccessfulSession(post("/session", { anonymousId }));
}

export async function getSession(sessionId: string): Promise<SessionResult> {
  const anonymousId = getOrCreateAnonymousId();
  const query = new URLSearchParams({ anonymousId });
  return persistSuccessfulSession(
    get(`/session/${encodeURIComponent(sessionId)}?${query}`),
  );
}

export async function getWorkspaceRevision(
  sessionId: string,
): Promise<{ status: "ok"; revision: string } | { status: "error" }> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const qs = new URLSearchParams({ anonymousId });
    const res = await get(
      `/session/${encodeURIComponent(sessionId)}/workspace-revision?${qs}`,
    );
    if (!res.ok) return { status: "error" };
    const body = (await res.json()) as { revision?: string };
    if (!body.revision) return { status: "error" };
    return { status: "ok", revision: body.revision };
  } catch {
    return { status: "error" };
  }
}

/**
 * Prefer create/resume via POST so the server can provision the sandbox
 * and Claude gateway. Dedupes by anonymousId + challenge date.
 * Also dedupes concurrent calls in the browser (React StrictMode double-mount).
 */
let ensureSessionInflight: Promise<SessionResult> | null = null;

export async function ensureSession(): Promise<SessionResult> {
  if (ensureSessionInflight) return ensureSessionInflight;
  ensureSessionInflight = createSession().finally(() => {
    ensureSessionInflight = null;
  });
  return ensureSessionInflight;
}

export async function pauseSession(
  sessionId: string,
): Promise<{ status: "ok" | "error"; message?: string }> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const res = await post(`/session/${encodeURIComponent(sessionId)}/pause`, {
      anonymousId,
    });
    if (!res.ok) {
      const body = await readJsonBody(res);
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status),
      };
    }
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}

/** Fire-and-forget pause for pagehide (may use keepalive). */
export function pauseSessionBeacon(sessionId: string): void {
  const anonymousId = getOrCreateAnonymousId();
  const url = `${API_BASE_URL}/session/${encodeURIComponent(sessionId)}/pause`;
  const body = JSON.stringify({ anonymousId });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // fall through
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export async function resumeSession(sessionId: string): Promise<SessionResult> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const res = await post(`/session/${encodeURIComponent(sessionId)}/resume`, {
      anonymousId,
    });
    return parseSessionResponse(res);
  } catch (error) {
    return requestFailure(error);
  }
}
