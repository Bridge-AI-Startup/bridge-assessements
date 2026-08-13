import { APIResult, get, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";

export type OpsQueueStats = {
  active: number;
  queued: number;
  maxConcurrent: number;
};

export type OpsWorkloadItem = {
  id: string;
  riskScore: number;
  riskSignals: string[];
  employer: {
    userId: string | null;
    email: string | null;
    companyName: string | null;
  };
  assessment: { id: string | null; title: string | null };
  submission: {
    id: string | null;
    candidateName: string | null;
    candidateEmail: string | null;
    status: string | null;
    tokenTruncated: string | null;
    evaluationStatus: string | null;
    evaluationError: string | null;
    behavioralGradingStatus: string | null;
    behavioralGradingError: string | null;
    behavioralGradingProgress: unknown;
    submittedAt: string | null;
    startedAt: string | null;
    updatedAt: string | null;
  };
  proctoring: null | {
    sessionId: string;
    status: string | null;
    mergedVideo: {
      status: string | null;
      sizeBytes: number;
      durationSeconds: number;
      mergingStartedAt: string | null;
      mergedAt: string | null;
      error: string | null;
    };
    transcript: {
      status: string | null;
      refinedStatus: string | null;
      frameCount: number;
      progressFramesProcessed: number | null;
      progressTotalFrames: number | null;
      generatedAt: string | null;
      error: string | null;
    };
    stats: {
      totalFrames: number;
      uniqueFrames: number;
      totalSizeBytes: number;
      totalChunks: number;
      totalVideoSizeBytes: number;
      captureStartedAt: string | null;
      captureEndedAt: string | null;
    };
    companionStatus: string | null;
    updatedAt: string | null;
    createdAt: string | null;
  };
  timestamps: {
    activityAt: string | null;
    proctoringUpdatedAt: string | null;
    submissionUpdatedAt: string | null;
  };
};

export type OpsWorkloadResponse = {
  generatedAt: string;
  windowHours: number;
  disclaimer: string;
  queues: {
    videoMerge: OpsQueueStats;
    behavioralGrading: OpsQueueStats;
    note: string;
  };
  summary: {
    items: number;
    activeProctoring: number;
    mergingVideos: number;
    generatingTranscripts: number;
    pendingBehavioral: number;
    pendingEvaluation: number;
    highRisk: number;
  };
  items: OpsWorkloadItem[];
};

export async function fetchOpsWorkload(opts?: {
  hours?: number;
  limit?: number;
}): Promise<APIResult<OpsWorkloadResponse>> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: "Not signed in" };
    }
    const token = await user.getIdToken();
    const params = new URLSearchParams();
    if (opts?.hours) params.set("hours", String(opts.hours));
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const response = await get(`/ops/workload${qs ? `?${qs}` : ""}`, {
      Authorization: `Bearer ${token}`,
    });
    const data = (await response.json()) as OpsWorkloadResponse;
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}
