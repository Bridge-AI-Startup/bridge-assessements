/**
 * Employer-facing workflow capture API.
 *
 * All of these are auth'd and ownership-checked server-side; the candidate-side
 * ingest endpoints (which use a capture token) deliberately live only in the
 * capture kit, not here.
 */

import { get } from "./requests";
import { API_BASE_URL } from "@/config/api";

/** Paths are relative — `requests` prefixes the API base itself. */
const BASE = "/workflow-capture";

export interface WorkflowCaptureSessionSummary {
  _id: string;
  candidateName?: string;
  status: "pending" | "active" | "completed";
  source?: string;
  startedAt?: string | null;
  lastEventAt?: string | null;
  completedAt?: string | null;
  stats?: {
    totalEvents: number;
    promptCount: number;
    toolUseCount: number;
    payloadBytes: number;
  };
  video?: {
    status?: string;
    chunks?: unknown[];
    segments?: Array<{
      wallStartedAt: string;
      wallEndedAt?: string | null;
      videoOffsetStart: number;
    }>;
  };
  episodes?: Array<{
    index: number;
    label: string;
    summary: string;
    kind: string;
    startSeconds: number;
    endSeconds: number;
    evidenceIndices: number[];
  }>;
}

export interface WorkflowTimelineRow {
  ts: number;
  ts_end: number;
  action_type: string;
  ai_tool: string | null;
  prompt_text: string | null;
  search_query: string | null;
  description: string;
  videoOffsetSeconds: number | null;
}

export interface WorkflowAnalysis {
  sessionId: string;
  startedAt: string;
  metrics: Record<string, any>;
  timeline: WorkflowTimelineRow[];
  episodes: WorkflowCaptureSessionSummary["episodes"];
  counts: { events: number; files: number };
}

/**
 * Find the capture session for a submission.
 * Returns `null` on 404 rather than throwing: a submission with no capture is
 * an ordinary state (screen-recording mode, or a candidate who never ran the
 * setup), and the dashboard should render an empty state, not an error string.
 */
export async function getCaptureSessionBySubmission(
  submissionId: string,
  token: string
): Promise<WorkflowCaptureSessionSummary | null> {
  try {
    const response = await get(`${BASE}/sessions/by-submission/${submissionId}`, {
      Authorization: `Bearer ${token}`,
    });
    const data = await response.json();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Metrics + gradable timeline + episodes. Null when unavailable.
 *
 * `episodes` costs an LLM call server-side, so it is opt-in per request: the
 * dashboard reads the persisted `session.episodes` first and only passes
 * `withEpisodes` when a reviewer explicitly asks to build them.
 */
export async function getWorkflowAnalysis(
  sessionId: string,
  token: string,
  options: { withEpisodes?: boolean } = {}
): Promise<WorkflowAnalysis | null> {
  try {
    const query = options.withEpisodes ? "?episodes=true" : "";
    const response = await get(`${BASE}/sessions/${sessionId}/analysis${query}`, {
      Authorization: `Bearer ${token}`,
    });
    return (await response.json()) as WorkflowAnalysis;
  } catch {
    return null;
  }
}

/** URL for the merged recording; the player fetches it with Range requests. */
export function workflowVideoUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/workflow-capture/sessions/${sessionId}/video`;
}
