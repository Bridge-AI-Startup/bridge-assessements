import { APIResult, post, get, handleAPIError } from "./requests";
import { API_BASE_URL } from "@/config/api";

export type ProctoringSession = {
  _id: string;
  submissionId: string;
  token: string;
  status: "pending" | "active" | "paused" | "completed" | "failed";
  consent: { granted: boolean; grantedAt: string | null; screens: number };
  stats: {
    totalFrames: number;
    uniqueFrames: number;
    duplicatesSkipped: number;
    totalSizeBytes: number;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * Create a proctoring session for a submission token.
 */
export async function createProctoringSession(
  token: string
): Promise<APIResult<ProctoringSession>> {
  try {
    const response = await post("/proctoring/sessions", { token });
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Grant consent for screen recording.
 */
export async function grantConsent(
  sessionId: string,
  token: string,
  screens: number
): Promise<APIResult<ProctoringSession>> {
  try {
    const response = await post(`/proctoring/sessions/${sessionId}/consent`, {
      token,
      screens,
    });
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Upload a single frame. Uses raw fetch with FormData (not JSON post helper).
 */
export async function uploadFrame(
  sessionId: string,
  token: string,
  frameBlob: Blob,
  metadata: {
    screenIndex: number;
    capturedAt: number;
    width: number;
    height: number;
    clientHash?: string;
  }
): Promise<APIResult<{ storageKey: string }>> {
  try {
    const formData = new FormData();
    formData.append("token", token);
    formData.append("frame", frameBlob, `${metadata.capturedAt}-${metadata.screenIndex}.png`);
    formData.append("screenIndex", String(metadata.screenIndex));
    formData.append("capturedAt", String(metadata.capturedAt));
    formData.append("width", String(metadata.width));
    formData.append("height", String(metadata.height));
    if (metadata.clientHash) {
      formData.append("clientHash", metadata.clientHash);
    }

    const response = await fetch(
      `${API_BASE_URL}/proctoring/sessions/${sessionId}/frames`,
      { method: "POST", body: formData }
    );

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || "Upload failed" };
    }
    return { success: true, data: result };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Record sidecar events (tab switches, blur/focus, etc).
 */
export async function recordSidecarEvents(
  sessionId: string,
  token: string,
  events: Array<{ type: string; timestamp: number; metadata?: Record<string, unknown> }>
): Promise<APIResult<{ recorded: number }>> {
  try {
    const response = await post(`/proctoring/sessions/${sessionId}/events`, {
      token,
      events,
    });
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Mark the proctoring session as complete.
 */
export async function completeSession(
  sessionId: string,
  token: string
): Promise<APIResult<ProctoringSession>> {
  try {
    const response = await post(`/proctoring/sessions/${sessionId}/complete`, {
      token,
    });
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get proctoring session details.
 */
export async function getSession(
  sessionId: string
): Promise<APIResult<ProctoringSession>> {
  try {
    const response = await get(`/proctoring/sessions/${sessionId}`);
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Create a dev-only test proctoring session (no real assessment needed).
 */
export async function createTestProctoringSession(): Promise<
  APIResult<{ session: ProctoringSession; token: string }>
> {
  try {
    const response = await post("/proctoring/sessions/test/create", {});
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Trigger AI transcript generation for a completed session.
 */
export async function generateTranscript(
  sessionId: string
): Promise<APIResult<{ status: string }>> {
  try {
    const response = await post(
      `/proctoring/sessions/${sessionId}/generate-transcript`,
      {}
    );
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get the JSONL transcript content for a session.
 */
export async function getTranscriptContent(
  sessionId: string
): Promise<APIResult<string>> {
  try {
    const response = await get(
      `/proctoring/sessions/${sessionId}/transcript`
    );
    const text = await response.text();
    return { success: true, data: text };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Upload a video chunk. Uses raw fetch with FormData.
 */
export async function uploadVideoChunk(
  sessionId: string,
  token: string,
  chunkBlob: Blob,
  metadata: {
    screenIndex: number;
    startTime: number;
    endTime?: number;
  }
): Promise<APIResult<{ storageKey: string }>> {
  try {
    const formData = new FormData();
    formData.append("token", token);
    formData.append("chunk", chunkBlob, `${metadata.startTime}-${metadata.screenIndex}.webm`);
    formData.append("screenIndex", String(metadata.screenIndex));
    formData.append("startTime", String(metadata.startTime));
    if (metadata.endTime) {
      formData.append("endTime", String(metadata.endTime));
    }

    const response = await fetch(
      `${API_BASE_URL}/proctoring/sessions/${sessionId}/video`,
      { method: "POST", body: formData }
    );

    const result = await response.json();
    if (!response.ok) {
      return { success: false, error: result.error || "Upload failed" };
    }
    return { success: true, data: result };
  } catch (error) {
    return handleAPIError(error);
  }
}
