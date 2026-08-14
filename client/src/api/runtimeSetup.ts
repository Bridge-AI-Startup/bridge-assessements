import { get, post, put, handleAPIError, type APIResult } from "./requests";
import { auth } from "@/firebase/firebase";
import { API_BASE_URL } from "@/config/api";

export type RuntimeEnvVar = {
  key: string;
  value: string;
  secret?: boolean;
  /** Secret values are blanked on read; this says whether one is stored. */
  hasValue?: boolean;
};

export type RuntimeConfig = {
  rootDir: string;
  installCommand: string;
  buildCommand: string | null;
  startCommand: string;
  port: number | null;
  healthPath: string | null;
  executionProfile: "cli_stdout" | "web_server" | "unclear";
  envVars: RuntimeEnvVar[];
  declaredEgressDomains: string[];
};

export type RuntimeSetupMeta = {
  status?: "not_started" | "in_progress" | "finalized";
  verified?: boolean;
  lastRunAt?: string | null;
  lastRunResult?: {
    ok?: boolean | null;
    exitCode?: number | null;
    error?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  } | null;
  finalizedAt?: string | null;
  snapshotSha256?: string | null;
  /** Captured at finalize so the recruiter panel can skip booting a sandbox. */
  evidence?: {
    healthOk?: boolean | null;
    healthSummary?: string | null;
    port?: number | null;
    capturedAt?: string | null;
    logTail?: Array<{ stream: string; text: string; t: string | null }>;
  } | null;
};

export type RuntimeSession = {
  sessionId: string;
  status: "provisioning" | "running" | "paused" | "dead";
  runPhase: string;
  port: number | null;
  previewUrl: string | null;
  health: { ok: boolean; summary: string | null; checkedAt: string | null };
  startedAt: string | null;
  lastActiveAt: string | null;
  pausedAt: string | null;
  error: string | null;
  hasSandbox: boolean;
};

export type RuntimeStatusResponse = {
  enabled: boolean;
  config: RuntimeConfig;
  setup: RuntimeSetupMeta;
  session: RuntimeSession | null;
};

export type RuntimeLogLine = {
  seq: number;
  t: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

export async function getRuntimeStatus(
  token: string
): Promise<APIResult<RuntimeStatusResponse>> {
  try {
    const response = await get(`/submissions/token/${token}/runtime/status`);
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function saveRuntimeConfig(
  token: string,
  config: RuntimeConfig
): Promise<APIResult<{ config: RuntimeConfig }>> {
  try {
    const response = await put(
      `/submissions/token/${token}/runtime/config`,
      config
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function createRuntimeSession(
  token: string
): Promise<APIResult<{ config: RuntimeConfig; session: RuntimeSession }>> {
  try {
    const response = await post(
      `/submissions/token/${token}/runtime/session`,
      {}
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function restartRuntime(
  token: string
): Promise<APIResult<{ config: RuntimeConfig; session: RuntimeSession }>> {
  try {
    const response = await post(
      `/submissions/token/${token}/runtime/restart`,
      {}
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function runRuntime(
  token: string
): Promise<APIResult<RuntimeStatusResponse & { ok: boolean }>> {
  try {
    const response = await post(`/submissions/token/${token}/runtime/run`, {});
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function getRuntimeLogs(
  token: string,
  after = 0
): Promise<APIResult<{ lines: RuntimeLogLine[]; nextSeq: number }>> {
  try {
    const response = await get(
      `/submissions/token/${token}/runtime/logs?after=${after}`
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function pauseRuntime(
  token: string
): Promise<APIResult<{ paused: boolean }>> {
  try {
    const response = await post(
      `/submissions/token/${token}/runtime/pause`,
      {}
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function resumeRuntime(
  token: string
): Promise<APIResult<{ config: RuntimeConfig; session: RuntimeSession }>> {
  try {
    const response = await post(
      `/submissions/token/${token}/runtime/resume`,
      {}
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export async function finalizeRuntime(
  token: string
): Promise<APIResult<{ setup: RuntimeSetupMeta; config: RuntimeConfig }>> {
  try {
    const response = await post(
      `/submissions/token/${token}/runtime/finalize`,
      {}
    );
    return { success: true, data: await response.json() };
  } catch (error) {
    return handleAPIError(error);
  }
}

export type RuntimeReplayStatusResponse = RuntimeStatusResponse & {
  ok?: boolean;
  accepted?: boolean;
  finalized?: boolean;
  snapshotSha256?: string | null;
  currentSnapshotSha256?: string | null;
};

async function recruiterFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<APIResult<T>> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: "No user is currently signed in" };
    }
    const authToken = await user.getIdToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${authToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    };
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error:
          (typeof result.error === "string" && result.error) ||
          `Request failed (${response.status})`,
      };
    }
    return { success: true, data: result as T };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Boots the finalized config in a sandbox. Without `restart`, a box that is
 * still serving is reconnected instead of reinstalled.
 */
export async function startRuntimeReplay(
  submissionId: string,
  opts: { restart?: boolean } = {}
): Promise<APIResult<RuntimeReplayStatusResponse>> {
  return recruiterFetch(`/submissions/${submissionId}/runtime/preview`, {
    method: "POST",
    body: JSON.stringify({ restart: Boolean(opts.restart) }),
  });
}

export async function getRuntimeReplayStatus(
  submissionId: string
): Promise<APIResult<RuntimeReplayStatusResponse>> {
  return recruiterFetch(`/submissions/${submissionId}/runtime/preview/status`);
}

export async function getRuntimeReplayLogs(
  submissionId: string,
  after = 0
): Promise<APIResult<{ lines: RuntimeLogLine[]; nextSeq: number }>> {
  return recruiterFetch(
    `/submissions/${submissionId}/runtime/preview/logs?after=${after}`
  );
}

export async function stopRuntimeReplay(
  submissionId: string
): Promise<APIResult<{ stopped: boolean; session: RuntimeSession | null }>> {
  return recruiterFetch(`/submissions/${submissionId}/runtime/preview/stop`, {
    method: "POST",
    body: "{}",
  });
}
