import { RequestHandler } from "express";
import mongoose from "mongoose";

import AssessmentModel from "../models/assessment.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import SubmissionModel from "../models/submission.js";
import UserModel from "../models/user.js";
import { getBehavioralGradingQueueStats } from "../services/behavioralGrading/index.js";
import { getVideoMergeQueueStats } from "../services/capture/sessionVideoMerge.js";

const DISCLAIMER =
  "Workload / risk signals from MongoDB — not crash telemetry. Correlate timestamps with Render logs for OOMs/restarts.";

const LARGE_VIDEO_BYTES = 80 * 1024 * 1024; // ~80 MB
const MANY_CHUNKS = 40;
const MANY_FRAMES = 500;

type RiskSignal =
  | "video_merging"
  | "transcript_generating"
  | "refined_transcript_generating"
  | "active_capture"
  | "large_video"
  | "many_chunks"
  | "many_frames"
  | "merge_failed"
  | "transcript_failed"
  | "behavioral_pending"
  | "evaluation_pending"
  | "behavioral_failed"
  | "evaluation_failed";

function truncToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 10) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function parseHours(raw: unknown, fallback = 24): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

function parseLimit(raw: unknown, fallback = 80): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(200, Math.max(10, Math.floor(n)));
}

function scoreSignals(signals: RiskSignal[]): number {
  const weights: Record<RiskSignal, number> = {
    video_merging: 50,
    transcript_generating: 45,
    refined_transcript_generating: 35,
    behavioral_pending: 40,
    evaluation_pending: 25,
    active_capture: 15,
    large_video: 30,
    many_chunks: 25,
    many_frames: 15,
    merge_failed: 12,
    transcript_failed: 10,
    behavioral_failed: 8,
    evaluation_failed: 6,
  };
  return signals.reduce((sum, s) => sum + (weights[s] || 0), 0);
}

function collectProctoringSignals(session: any): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const mv = session.mergedVideo || {};
  const tr = session.transcript || {};
  const stats = session.stats || {};
  const videoStats = stats.videoStats || {};
  const videoBytes =
    Number(mv.sizeBytes) ||
    Number(videoStats.totalVideoSizeBytes) ||
    Number(stats.totalSizeBytes) ||
    0;
  const chunks = Number(videoStats.totalChunks) || 0;
  const frames = Number(stats.totalFrames) || 0;

  if (mv.status === "merging") signals.push("video_merging");
  if (tr.status === "generating") signals.push("transcript_generating");
  if (tr.refinedStatus === "generating") {
    signals.push("refined_transcript_generating");
  }
  if (session.status === "active" || session.status === "paused") {
    signals.push("active_capture");
  }
  if (videoBytes >= LARGE_VIDEO_BYTES) signals.push("large_video");
  if (chunks >= MANY_CHUNKS) signals.push("many_chunks");
  if (frames >= MANY_FRAMES) signals.push("many_frames");
  if (mv.status === "failed") signals.push("merge_failed");
  if (tr.status === "failed") signals.push("transcript_failed");
  return signals;
}

/**
 * GET /api/ops/workload
 * Auth + OPS_ADMIN_EMAIL. Aggregates heavy / crash-prone work with employer attribution.
 */
export const getWorkload: RequestHandler = async (req, res, next) => {
  try {
    const hours = parseHours(req.query.hours);
    const limit = parseLimit(req.query.limit);
    const since = hoursAgo(hours);

    // Omit frames / sidecarEvents / videoChunks arrays — sizes come from stats.
    const proctoringProjection = {
      submissionId: 1,
      token: 1,
      status: 1,
      mergedVideo: 1,
      transcript: 1,
      stats: 1,
      companion: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    const [hotSessions, recentHeavySessions, pendingSubs] = await Promise.all([
      ProctoringSessionModel.find({
        $or: [
          { status: { $in: ["active", "paused"] } },
          { "mergedVideo.status": "merging" },
          { "transcript.status": "generating" },
          { "transcript.refinedStatus": "generating" },
        ],
      })
        .select(proctoringProjection)
        .lean(),
      ProctoringSessionModel.find({
        updatedAt: { $gte: since },
        $or: [
          { "mergedVideo.status": { $in: ["merging", "ready", "failed"] } },
          {
            "transcript.status": {
              $in: ["generating", "completed", "failed"],
            },
          },
          { "stats.videoStats.totalVideoSizeBytes": { $gte: LARGE_VIDEO_BYTES } },
          { "stats.videoStats.totalChunks": { $gte: MANY_CHUNKS } },
          { "stats.totalFrames": { $gte: MANY_FRAMES } },
          { "mergedVideo.sizeBytes": { $gte: LARGE_VIDEO_BYTES } },
        ],
      })
        .select(proctoringProjection)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),
      SubmissionModel.find({
        $or: [
          { behavioralGradingStatus: "pending" },
          { evaluationStatus: "pending" },
          {
            behavioralGradingStatus: { $in: ["completed", "failed"] },
            updatedAt: { $gte: since },
          },
          {
            evaluationStatus: { $in: ["completed", "failed"] },
            updatedAt: { $gte: since },
          },
        ],
      })
        .select(
          "assessmentId candidateName candidateEmail status token evaluationStatus evaluationError behavioralGradingStatus behavioralGradingError behavioralGradingProgress submittedAt startedAt createdAt updatedAt"
        )
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const sessionById = new Map<string, any>();
    for (const s of [...hotSessions, ...recentHeavySessions]) {
      sessionById.set(String(s._id), s);
    }

    const submissionIds = new Set<string>();
    for (const s of sessionById.values()) {
      if (s.submissionId) submissionIds.add(String(s.submissionId));
    }
    for (const sub of pendingSubs) {
      submissionIds.add(String(sub._id));
    }

    const submissions = await SubmissionModel.find({
      _id: {
        $in: [...submissionIds].map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .select(
        "assessmentId candidateName candidateEmail status token evaluationStatus evaluationError behavioralGradingStatus behavioralGradingError behavioralGradingProgress submittedAt startedAt createdAt updatedAt"
      )
      .lean();

    const submissionById = new Map<string, any>();
    for (const sub of submissions) {
      submissionById.set(String(sub._id), sub);
    }
    for (const sub of pendingSubs) {
      if (!submissionById.has(String(sub._id))) {
        submissionById.set(String(sub._id), sub);
      }
    }

    const assessmentIds = [
      ...new Set(
        [...submissionById.values()]
          .map((s) => (s.assessmentId ? String(s.assessmentId) : null))
          .filter(Boolean) as string[]
      ),
    ];

    const assessments = assessmentIds.length
      ? await AssessmentModel.find({
          _id: {
            $in: assessmentIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("title userId")
          .lean()
      : [];

    const assessmentById = new Map<string, any>();
    for (const a of assessments) {
      assessmentById.set(String(a._id), a);
    }

    const userIds = [
      ...new Set(
        assessments
          .map((a) => (a.userId ? String(a.userId) : null))
          .filter(Boolean) as string[]
      ),
    ];

    const users = userIds.length
      ? await UserModel.find({
          _id: {
            $in: userIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("email companyName")
          .lean()
      : [];

    const userById = new Map<string, any>();
    for (const u of users) {
      userById.set(String(u._id), u);
    }

    type WorkloadItem = {
      id: string;
      riskScore: number;
      riskSignals: RiskSignal[];
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

    const itemsByKey = new Map<string, WorkloadItem>();

    const attributionForSubmission = (sub: any) => {
      const assessment = sub?.assessmentId
        ? assessmentById.get(String(sub.assessmentId))
        : null;
      const employer = assessment?.userId
        ? userById.get(String(assessment.userId))
        : null;
      return {
        employer: {
          userId: assessment?.userId ? String(assessment.userId) : null,
          email: employer?.email ?? null,
          companyName: employer?.companyName ?? null,
        },
        assessment: {
          id: assessment ? String(assessment._id) : sub?.assessmentId
            ? String(sub.assessmentId)
            : null,
          title: assessment?.title ?? null,
        },
        submission: {
          id: sub ? String(sub._id) : null,
          candidateName: sub?.candidateName ?? null,
          candidateEmail: sub?.candidateEmail ?? null,
          status: sub?.status ?? null,
          tokenTruncated: truncToken(sub?.token),
          evaluationStatus: sub?.evaluationStatus ?? null,
          evaluationError: sub?.evaluationError ?? null,
          behavioralGradingStatus: sub?.behavioralGradingStatus ?? null,
          behavioralGradingError: sub?.behavioralGradingError ?? null,
          behavioralGradingProgress: sub?.behavioralGradingProgress ?? null,
          submittedAt: sub?.submittedAt
            ? new Date(sub.submittedAt).toISOString()
            : null,
          startedAt: sub?.startedAt
            ? new Date(sub.startedAt).toISOString()
            : null,
          updatedAt: sub?.updatedAt
            ? new Date(sub.updatedAt).toISOString()
            : null,
        },
      };
    };

    for (const session of sessionById.values()) {
      const sub = session.submissionId
        ? submissionById.get(String(session.submissionId))
        : null;
      const attr = attributionForSubmission(sub);
      const signals = collectProctoringSignals(session);
      if (sub?.behavioralGradingStatus === "pending") {
        signals.push("behavioral_pending");
      }
      if (sub?.evaluationStatus === "pending") {
        signals.push("evaluation_pending");
      }
      if (sub?.behavioralGradingStatus === "failed") {
        signals.push("behavioral_failed");
      }
      if (sub?.evaluationStatus === "failed") {
        signals.push("evaluation_failed");
      }
      if (signals.length === 0) continue;

      const mv = session.mergedVideo || {};
      const tr = session.transcript || {};
      const stats = session.stats || {};
      const videoStats = stats.videoStats || {};
      const key = `proc:${session._id}`;
      const activityAt =
        session.updatedAt ||
        mv.mergingStartedAt ||
        tr.generatedAt ||
        stats.captureEndedAt ||
        stats.captureStartedAt ||
        session.createdAt;

      itemsByKey.set(key, {
        id: key,
        riskScore: scoreSignals(signals),
        riskSignals: signals,
        ...attr,
        proctoring: {
          sessionId: String(session._id),
          status: session.status ?? null,
          mergedVideo: {
            status: mv.status ?? null,
            sizeBytes: Number(mv.sizeBytes) || 0,
            durationSeconds: Number(mv.durationSeconds) || 0,
            mergingStartedAt: mv.mergingStartedAt
              ? new Date(mv.mergingStartedAt).toISOString()
              : null,
            mergedAt: mv.mergedAt
              ? new Date(mv.mergedAt).toISOString()
              : null,
            error: mv.error ?? null,
          },
          transcript: {
            status: tr.status ?? null,
            refinedStatus: tr.refinedStatus ?? null,
            frameCount: Number(tr.frameCount) || 0,
            progressFramesProcessed:
              tr.progressFramesProcessed != null
                ? Number(tr.progressFramesProcessed)
                : null,
            progressTotalFrames:
              tr.progressTotalFrames != null
                ? Number(tr.progressTotalFrames)
                : null,
            generatedAt: tr.generatedAt
              ? new Date(tr.generatedAt).toISOString()
              : null,
            error: tr.error ?? null,
          },
          stats: {
            totalFrames: Number(stats.totalFrames) || 0,
            uniqueFrames: Number(stats.uniqueFrames) || 0,
            totalSizeBytes: Number(stats.totalSizeBytes) || 0,
            totalChunks: Number(videoStats.totalChunks) || 0,
            totalVideoSizeBytes: Number(videoStats.totalVideoSizeBytes) || 0,
            captureStartedAt: stats.captureStartedAt
              ? new Date(stats.captureStartedAt).toISOString()
              : null,
            captureEndedAt: stats.captureEndedAt
              ? new Date(stats.captureEndedAt).toISOString()
              : null,
          },
          companionStatus: session.companion?.status ?? null,
          updatedAt: session.updatedAt
            ? new Date(session.updatedAt).toISOString()
            : null,
          createdAt: session.createdAt
            ? new Date(session.createdAt).toISOString()
            : null,
        },
        timestamps: {
          activityAt: activityAt ? new Date(activityAt).toISOString() : null,
          proctoringUpdatedAt: session.updatedAt
            ? new Date(session.updatedAt).toISOString()
            : null,
          submissionUpdatedAt: attr.submission.updatedAt,
        },
      });
    }

    // Submissions with pending/recent grading that may not have a proctoring session
    const coveredSubmissionIds = new Set(
      [...itemsByKey.values()]
        .map((item) => item.submission.id)
        .filter(Boolean) as string[]
    );
    for (const sub of pendingSubs) {
      if (coveredSubmissionIds.has(String(sub._id))) continue;

      const signals: RiskSignal[] = [];
      if (sub.behavioralGradingStatus === "pending") {
        signals.push("behavioral_pending");
      }
      if (sub.evaluationStatus === "pending") {
        signals.push("evaluation_pending");
      }
      if (sub.behavioralGradingStatus === "failed") {
        signals.push("behavioral_failed");
      }
      if (sub.evaluationStatus === "failed") {
        signals.push("evaluation_failed");
      }
      if (signals.length === 0) continue;

      const attr = attributionForSubmission(sub);
      itemsByKey.set(`sub:${sub._id}`, {
        id: `sub:${sub._id}`,
        riskScore: scoreSignals(signals),
        riskSignals: signals,
        ...attr,
        proctoring: null,
        timestamps: {
          activityAt: attr.submission.updatedAt,
          proctoringUpdatedAt: null,
          submissionUpdatedAt: attr.submission.updatedAt,
        },
      });
    }

    const items = [...itemsByKey.values()]
      .sort((a, b) => {
        if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
        const at = a.timestamps.activityAt
          ? new Date(a.timestamps.activityAt).getTime()
          : 0;
        const bt = b.timestamps.activityAt
          ? new Date(b.timestamps.activityAt).getTime()
          : 0;
        return bt - at;
      })
      .slice(0, limit);

    const summary = {
      items: items.length,
      activeProctoring: items.filter((i) =>
        i.riskSignals.includes("active_capture")
      ).length,
      mergingVideos: items.filter((i) =>
        i.riskSignals.includes("video_merging")
      ).length,
      generatingTranscripts: items.filter(
        (i) =>
          i.riskSignals.includes("transcript_generating") ||
          i.riskSignals.includes("refined_transcript_generating")
      ).length,
      pendingBehavioral: items.filter((i) =>
        i.riskSignals.includes("behavioral_pending")
      ).length,
      pendingEvaluation: items.filter((i) =>
        i.riskSignals.includes("evaluation_pending")
      ).length,
      highRisk: items.filter((i) => i.riskScore >= 40).length,
    };

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      windowHours: hours,
      disclaimer: DISCLAIMER,
      queues: {
        videoMerge: getVideoMergeQueueStats(),
        behavioralGrading: getBehavioralGradingQueueStats(),
        note: "Queue counts are in-process on this Render instance only (not shared across scaled instances).",
      },
      summary,
      items,
    });
  } catch (error) {
    next(error);
  }
};
