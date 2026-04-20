import { APIResult, post, get, handleAPIError } from "./requests";
import { API_BASE_URL } from "@/config/api";

/** Trigger browser download of a blob with the given filename */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
    captureStartedAt?: string | null;
    captureEndedAt?: string | null;
    videoStats?: {
      totalChunks?: number;
      totalVideoSizeBytes?: number;
      durationSeconds?: number;
    };
  };
  transcript?: {
    status: string;
    storageKey?: string;
  };
  videoChunks?: Array<{
    storageKey: string;
    screenIndex: number;
    startTime: string;
    endTime?: string | null;
    sizeBytes?: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

/**
 * Get proctoring session by submission ID (employer auth required).
 */
export async function getSessionBySubmission(
  submissionId: string,
  authToken: string
): Promise<APIResult<ProctoringSession>> {
  try {
    const response = await get(
      `/proctoring/sessions/by-submission/${submissionId}`,
      { Authorization: `Bearer ${authToken}` }
    );
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

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

export type StorageSessionEntry = {
  sessionId: string;
  frameCount: number;
  videoCount: number;
  inDb: boolean;
  transcriptStatus?: string;
  refinedStatus?: string;
};

/**
 * List session directories in storage/proctoring (dev only).
 * Returns sessions with frame/video counts and DB transcript status.
 */
export async function listStorageSessions(): Promise<
  APIResult<{ sessions: StorageSessionEntry[] }>
> {
  try {
    const response = await get("/proctoring/sessions/test/list-storage-sessions");
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
 * Trigger refinement of the raw transcript (GPT-4o refiner → transcript_refined.jsonl).
 * Requires backend POST /proctoring/sessions/:sessionId/refine-transcript.
 */
export async function refineTranscript(
  sessionId: string
): Promise<APIResult<{ status: string }>> {
  try {
    const response = await post(
      `/proctoring/sessions/${sessionId}/refine-transcript`,
      {}
    );
    const data = await response.json();
    return { success: true, data: data as { status: string } };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get the refined JSONL transcript content for a session.
 * Requires backend GET /proctoring/sessions/:sessionId/transcript/refined (or equivalent).
 */
export async function getRefinedTranscriptContent(
  sessionId: string
): Promise<APIResult<string>> {
  try {
    const response = await get(
      `/proctoring/sessions/${sessionId}/transcript/refined`
    );
    const text = await response.text();
    return { success: true, data: text };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Fetch re-muxed WebM video for in-page playback (correct duration). Returns an object URL;
 * caller must call URL.revokeObjectURL(objectUrl) when done to avoid leaks.
 */
export async function getProctoringVideoPlaybackUrl(
  sessionId: string,
  authToken: string
): Promise<APIResult<string>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/proctoring/sessions/${sessionId}/playback-video`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        error: data.error || `Video unavailable (${response.status})`,
      };
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return { success: true, data: objectUrl };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Download merged WebM video for a session. Triggers a file download in the browser.
 */
export async function downloadProctoringVideo(
  sessionId: string
): Promise<APIResult<void>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/proctoring/sessions/${sessionId}/download-video`
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        error: data.error || `Download failed (${response.status})`,
      };
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proctoring-${sessionId}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get debug frame data for a session (dev only).
 * Returns extracted frames as thumbnails with region detection bounding boxes.
 */
export async function getDebugFrames(
  sessionId: string,
  options: { maxFrames?: number; detect?: boolean } = {}
): Promise<APIResult<any>> {
  try {
    const params = new URLSearchParams();
    if (options.maxFrames) params.set("maxFrames", String(options.maxFrames));
    if (options.detect === false) params.set("detect", "false");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const response = await get(
      `/proctoring/sessions/${sessionId}/debug-frames${qs}`
    );
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Render overlay PNG from regions + dimensions (no detection).
 * Use when you already have regions from a frame (e.g. from getDebugFrames).
 */
export async function renderOverlay(
  regions: Array<{ regionType: string; x: number; y: number; width: number; height: number }>,
  width: number,
  height: number
): Promise<APIResult<void>> {
  try {
    const response = await fetch(`${API_BASE_URL}/proctoring/render-overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regions, width, height }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const json = JSON.parse(text);
        if (json?.error) message = json.error;
      } catch {
        // use text as-is
      }
      return { success: false, error: message };
    }
    const blob = await response.blob();
    downloadBlob(blob, "bounding-boxes-overlay.png");
    return { success: true, data: undefined };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Export bounding box overlay PNG for a session (dev only).
 * Runs region detection on the first frame and triggers download of bounding-boxes-overlay.png.
 */
export async function exportOverlays(sessionId: string): Promise<APIResult<void>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/proctoring/sessions/${sessionId}/export-overlays`
    );
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const json = JSON.parse(text);
        if (json?.error) message = json.error;
      } catch {
        // use text as-is
      }
      return { success: false, error: message };
    }
    const blob = await response.blob();
    downloadBlob(blob, "bounding-boxes-overlay.png");
    return { success: true, data: undefined };
  } catch (error) {
    return handleAPIError(error);
  }
}

/** Enriched transcript from the activity interpreter (one strategy). */
export type EnrichedTranscript = {
  events: Array<{
    ts: number;
    ts_end: number;
    behavioral_summary: string;
    intent: string;
    regions_present: string[];
    ai_tool: string | null;
    raw_regions?: Array<{ region: string; text_content: string }>;
  }>;
  session_narrative: string;
  strategy: "chunked" | "stateful";
  processing_stats: {
    llm_calls: number;
    total_tokens: number;
    processing_time_ms: number;
  };
};

/**
 * Run both activity interpreter strategies (chunked + stateful) on the
 * session's raw transcript. Returns processed transcripts for comparison.
 */
export async function interpretTranscript(
  sessionId: string
): Promise<
  APIResult<{ chunked: EnrichedTranscript; stateful: EnrichedTranscript }>
> {
  try {
    const response = await post(
      `/proctoring/sessions/${sessionId}/interpret-transcript`,
      {}
    );
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Paste raw JSONL transcript and get both strategies (chunked + stateful).
 * For testing with cofounder-provided raw transcripts.
 */
export async function interpretRawTranscript(
  rawJsonl: string
): Promise<
  APIResult<{ chunked: EnrichedTranscript; stateful: EnrichedTranscript }>
> {
  try {
    const response = await post("/proctoring/interpret-raw-transcript", {
      rawJsonl,
    });
    const data = await response.json();
    return { success: true, data };
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
