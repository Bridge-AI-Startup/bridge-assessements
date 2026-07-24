import {
  get,
  getRequestErrorMessage,
  getResponseErrorMessage,
  put,
  readJsonBody,
} from "@/api/requests";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";

export type WorkspaceFileEntry = {
  path: string;
  sizeBytes?: number;
};

export async function listWorkspaceFiles(
  sessionId: string,
): Promise<
  | { status: "ok"; files: WorkspaceFileEntry[] }
  | { status: "error"; message: string }
> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const qs = new URLSearchParams({ anonymousId });
    const res = await get(
      `/session/${encodeURIComponent(sessionId)}/files?${qs}`,
    );
    const body = await readJsonBody(res);
    if (!res.ok) {
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status),
      };
    }
    const files = Array.isArray(body.files) ? body.files : [];
    return { status: "ok", files };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}

export async function readWorkspaceFile(
  sessionId: string,
  path: string,
): Promise<
  | { status: "ok"; path: string; content: string }
  | { status: "error"; message: string }
> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const qs = new URLSearchParams({ anonymousId, path });
    const res = await get(
      `/session/${encodeURIComponent(sessionId)}/file?${qs}`,
    );
    const body = await readJsonBody(res);
    if (!res.ok) {
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status),
      };
    }
    return {
      status: "ok",
      path: String(body.path || path),
      content: String(body.content ?? ""),
    };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}

export async function writeWorkspaceFile(
  sessionId: string,
  path: string,
  content: string,
): Promise<{ status: "ok"; path: string; bytes: number } | { status: "error"; message: string }> {
  const anonymousId = getOrCreateAnonymousId();
  try {
    const res = await put(`/session/${encodeURIComponent(sessionId)}/file`, {
      anonymousId,
      path,
      content,
    });
    const body = await readJsonBody(res);
    if (!res.ok) {
      return {
        status: "error",
        message: getResponseErrorMessage(body, res.status),
      };
    }
    return {
      status: "ok",
      path: String(body.path || path),
      bytes: Number(body.bytes || 0),
    };
  } catch (error) {
    return {
      status: "error",
      message: getRequestErrorMessage(error),
    };
  }
}
