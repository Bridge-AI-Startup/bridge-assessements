import { RequestHandler } from "express";
import { validationResult } from "express-validator";
import crypto from "crypto";
import mongoose from "mongoose";
import path from "path";
import fs from "fs/promises";
import validationErrorParser from "../utils/validationErrorParser.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";
import { ProctoringError } from "../errors/proctoring.js";
import {
  storeFrame,
  storeVideoChunkFromFile,
} from "../services/capture/frameStorage.js";
import {
  mergeSessionVideo,
  mergeSessionVideoInBackground,
} from "../services/capture/sessionVideoMerge.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";
import { resolveEvidenceMode } from "../utils/evidenceMode.js";
import {
  buildCompanionFirstMessage,
  companionSetupPromptNotes,
  type CompanionSetupFacts,
} from "../services/companion/firstMessage.js";

// POST /api/proctoring/sessions
export const createSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { token } = req.body;
    const submission = await SubmissionModel.findOne({ token });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Return existing session if one already exists
    const existing = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    });
    if (existing) {
      return res.status(200).json(existing);
    }

    const session = await ProctoringSessionModel.create({
      submissionId: submission._id,
      token,
      status: "pending",
    });

    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/consent
export const grantConsent: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token, screens } = req.body;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    session.consent = {
      granted: true,
      grantedAt: new Date(),
      screens: screens || 1,
    };
    session.status = "active";
    await session.save();

    res.json(session);
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/frames
export const uploadFrame: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const file = req.file;
    if (!file) {
      throw ProctoringError.INVALID_FRAME_DATA;
    }

    const token = req.body.token;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }
    if (session.status !== "active") {
      return res.status(409).json({ error: "Session is no longer recording" });
    }

    const result = await storeFrame(sessionId, file.buffer, {
      screenIndex: parseInt(req.body.screenIndex) || 0,
      capturedAt: new Date(parseInt(req.body.capturedAt) || Date.now()),
      width: parseInt(req.body.width) || undefined,
      height: parseInt(req.body.height) || undefined,
      clientHash: req.body.clientHash || undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/frames/batch
export const uploadFrameBatch: RequestHandler = async (req, res, next) => {
  try {
    res.status(501).json({ error: "Not implemented" });
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/events
export const recordSidecarEvents: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token, events } = req.body;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }
    if (session.status !== "active") {
      return res.status(409).json({ error: "Session is no longer recording" });
    }

    const formatted = events.map(
      (e: {
        type: string;
        timestamp: number;
        metadata?: Record<string, unknown>;
      }) => ({
        type: e.type,
        timestamp: new Date(e.timestamp),
        metadata: e.metadata || {},
      }),
    );

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      $push: { sidecarEvents: { $each: formatted } },
    });

    res.json({ recorded: formatted.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/complete
export const completeSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token } = req.body;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    session.status = "completed";
    session.stats.captureEndedAt = new Date();
    await session.save();

    mergeSessionVideoInBackground(sessionId);

    res.json(session);
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/by-candidate-token?token=
/** Look up an existing proctoring session for this submission token (no create). Used after reload to resume recording. */
export const getSessionByCandidateToken: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const token = String(req.query.token).trim();

    const submission = await SubmissionModel.findOne({ token });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const session = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    });
    if (!session) {
      return res.status(404).json({ error: "No proctoring session" });
    }
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
};

/**
 * Access check shared by the generic session GETs: the candidate's session
 * token (query `?token=`) or the employer who owns the linked assessment.
 * Dev keeps open access so the local test pages work without credentials —
 * same NODE_ENV gating as the debug endpoints.
 */
async function canAccessSession(
  req: Parameters<RequestHandler>[0],
  session: { token: string; submissionId: unknown }
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const token = req.query.token as string | undefined;
  if (token && session.token === token) return true;
  const authUser = (req as any).user;
  if (authUser?.uid) {
    try {
      const userId = await getUserIdFromFirebaseUid(authUser.uid);
      const submission = await SubmissionModel.findById(
        session.submissionId
      ).populate("assessmentId");
      const assessment = submission?.assessmentId as {
        userId?: unknown;
      } | null;
      if (assessment && String(assessment.userId) === String(userId)) {
        return true;
      }
    } catch {
      // auth lookup failed; fall through to denial
    }
  }
  return false;
}

// GET /api/proctoring/sessions/:sessionId
export const getSession: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (!(await canAccessSession(req, session))) {
      return res.status(403).json({ error: "Access denied" });
    }
    // The session token is the credential for every candidate-side endpoint —
    // it must never ride along on a generic read.
    const payload = session.toObject() as Record<string, unknown>;
    delete payload.token;
    res.json(payload);
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/transcript
export const getTranscript: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (!(await canAccessSession(req, session))) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (
      session.transcript.status !== "completed" ||
      !session.transcript.storageKey
    ) {
      return res.status(404).json({ error: "Transcript not available" });
    }

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();
    const content = await storage.getTranscript(session.transcript.storageKey);

    res.setHeader("Content-Type", "application/jsonl");
    res.send(content);
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/generate-transcript
export const generateSessionTranscript: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;

    // Import from ai/ module — only import in this one controller method
    const { generateTranscript } =
      await import("../ai/transcript/generator.js");

    const result = await generateTranscript(sessionId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const DEBUG_VIDEO = true; // set to false to disable [proctoring-video] logs
const dv = (...args: unknown[]) => {
  if (DEBUG_VIDEO) console.log("[proctoring-video]", ...args);
};

// GET /api/proctoring/sessions/by-submission/:submissionId
export const getSessionBySubmission: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { submissionId } = req.params;
    dv("[getSessionBySubmission] step 1: param submissionId =", submissionId, "type:", typeof submissionId, "length:", String(submissionId).length);
    const submissionIdObj = mongoose.Types.ObjectId.isValid(submissionId)
      ? new mongoose.Types.ObjectId(submissionId)
      : null;
    const session = await ProctoringSessionModel.findOne(
      submissionIdObj ? { submissionId: submissionIdObj } : { submissionId },
    );
    if (!session) {
      dv("[getSessionBySubmission] step 2: session NOT FOUND for submissionId:", submissionId);
      throw ProctoringError.SESSION_NOT_FOUND;
    }
    dv("[getSessionBySubmission] step 2: session FOUND. session._id =", session._id, "type:", typeof session._id, "session.submissionId =", session.submissionId, "type:", typeof session.submissionId);

    const payload = session.toObject ? session.toObject() : session;
    // Employers own the assessment, not the candidate's session credential.
    delete (payload as Record<string, unknown>).token;
    const stored =
      payload.stats?.videoStats?.durationSeconds != null &&
      payload.stats.videoStats.durationSeconds > 0;
    if (!stored && payload.videoChunks?.length > 0) {
      let totalSec = 0;
      for (const ch of payload.videoChunks as Array<{ startTime?: Date | string; endTime?: Date | null }>) {
        const start = ch.startTime ? new Date(ch.startTime).getTime() : NaN;
        const end = (ch.endTime ? new Date(ch.endTime) : ch.startTime ? new Date(ch.startTime) : null)?.getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          totalSec += (end - start) / 1000;
        }
      }
      if (!payload.stats) payload.stats = {} as Record<string, unknown>;
      if (!payload.stats.videoStats) payload.stats.videoStats = {} as Record<string, unknown>;
      (payload.stats.videoStats as Record<string, unknown>).durationSeconds = totalSec;
    }

    const merged = payload.mergedVideo as
      | { status?: string; durationSeconds?: number }
      | undefined;
    if (
      merged?.status === "ready" &&
      typeof merged.durationSeconds === "number" &&
      merged.durationSeconds > 0
    ) {
      if (!payload.stats) payload.stats = {} as Record<string, unknown>;
      if (!payload.stats.videoStats) payload.stats.videoStats = {} as Record<string, unknown>;
      const vs = payload.stats.videoStats as Record<string, unknown>;
      if (
        !(typeof vs.durationSeconds === "number" && vs.durationSeconds > 0)
      ) {
        vs.durationSeconds = merged.durationSeconds;
      }
    }

    payload._id = payload._id?.toString?.() ?? payload._id;
    payload.submissionId =
      payload.submissionId?.toString?.() ?? payload.submissionId;
    dv("[getSessionBySubmission] step 3: returning payload. payload._id =", payload._id, "payload.submissionId =", payload.submissionId);
    res.json(payload);
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/video
// Chunk arrives on disk via multer diskStorage; stream it into storage and always
// unlink the temp file, including on validation failures and thrown errors.
export const uploadVideoChunk: RequestHandler = async (req, res, next) => {
  const file = req.file;
  try {
    const { sessionId } = req.params;
    if (!file) {
      return res.status(400).json({ error: "No video chunk provided" });
    }

    const token = req.body.token;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }
    if (session.status !== "active") {
      return res.status(409).json({ error: "Session is no longer recording" });
    }

    const startRaw = req.body.startTime ?? Date.now();
    const endRaw = req.body.endTime;
    const startTime =
      typeof startRaw === "number" || /^\d+$/.test(String(startRaw))
        ? new Date(Number(startRaw))
        : new Date(startRaw);
    const endTime =
      endRaw == null
        ? undefined
        : typeof endRaw === "number" || /^\d+$/.test(String(endRaw))
          ? new Date(Number(endRaw))
          : new Date(endRaw);
    if (Number.isNaN(startTime.getTime())) {
      return res.status(400).json({ error: "Invalid startTime" });
    }
    if (endTime !== undefined && Number.isNaN(endTime.getTime())) {
      return res.status(400).json({ error: "Invalid endTime" });
    }

    const result = await storeVideoChunkFromFile(sessionId, file.path, {
      screenIndex: parseInt(req.body.screenIndex) || 0,
      startTime,
      endTime,
    });

    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    if (file?.path) {
      await fs.unlink(file.path).catch(() => {});
    }
  }
};

/**
 * Make sure the session's eager merge has run (idempotent, slot-queued), then
 * return the merged playback key if it exists. Persisting the merge here means
 * an employer viewing before the background merge finished does the work once,
 * not on every page load.
 *
 * Only merges once the session is over (completed/failed): merging while the
 * candidate is still recording would freeze playback.webm early and orphan
 * every chunk uploaded afterwards (merge is skipped once status is "ready").
 */
async function ensureMergedPlayback(
  sessionId: string,
  storage: import("../services/capture/storage.js").IFrameStorage,
): Promise<string | null> {
  const fresh = await ProctoringSessionModel.findById(sessionId);
  const merged = fresh?.mergedVideo as
    | { status?: string; storageKey?: string | null }
    | undefined;
  if (
    merged?.status === "ready" &&
    merged.storageKey &&
    (await storage.exists(merged.storageKey))
  ) {
    return merged.storageKey;
  }

  if (fresh?.status !== "completed" && fresh?.status !== "failed") {
    return null;
  }

  await mergeSessionVideo(sessionId);

  const after = await ProctoringSessionModel.findById(sessionId);
  const mergedAfter = after?.mergedVideo as
    | { status?: string; storageKey?: string | null }
    | undefined;
  if (
    mergedAfter?.status === "ready" &&
    mergedAfter.storageKey &&
    (await storage.exists(mergedAfter.storageKey))
  ) {
    return mergedAfter.storageKey;
  }
  return null;
}

async function requireEmployerOwnsProctoringSession(
  req: { user?: { uid?: string } },
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  sessionId: string,
): Promise<{ session: InstanceType<typeof ProctoringSessionModel> } | null> {
  const uid = req.user?.uid;
  if (!uid) {
    dv("[requireEmployerOwnsProctoringSession] no uid, returning 401");
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) {
    throw ProctoringError.SESSION_NOT_FOUND;
  }

  const submission = await SubmissionModel.findById(session.submissionId);
  if (!submission) {
    throw ProctoringError.SESSION_NOT_FOUND;
  }
  const assessment = await AssessmentModel.findById(submission.assessmentId);
  if (!assessment) {
    res.status(403).json({ error: "Access denied to this session" });
    return null;
  }
  const userId = await getUserIdFromFirebaseUid(uid);
  const assessmentOwnerId = assessment.userId?.toString?.() ?? assessment.userId;
  if (!userId || assessmentOwnerId !== userId.toString()) {
    res.status(403).json({ error: "Access denied to this session" });
    return null;
  }
  return { session };
}

// GET /api/proctoring/sessions/:sessionId/playback-video
// Video bytes are never proxied through this API. Auth required; employer must own the submission.
// `?format=url` returns JSON `{ url }` — a presigned S3 GET. Without that query, 302 to the same URL.
export const getPlaybackVideo: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    dv("[getPlaybackVideo] step 1: param sessionId =", sessionId, "type:", typeof sessionId);
    const owned = await requireEmployerOwnsProctoringSession(req as any, res, sessionId);
    if (!owned) return;

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();

    const mergedKey = await ensureMergedPlayback(sessionId, storage);
    if (!mergedKey) {
      dv("[getPlaybackVideo] step 5: no merged playback key");
      return res.status(404).json({ error: "Video is not ready for playback" });
    }

    const url = await storage.getSignedDownloadUrl(mergedKey);
    dv("[getPlaybackVideo] step 5: mergedKey =", mergedKey, "presigned =", url != null);
    if (!url) {
      return res.status(503).json({
        error: "Direct S3 playback URL unavailable. Video is not proxied through this API.",
        url: null,
      });
    }

    if (req.query.format === "url") {
      return res.json({ url });
    }
    return res.redirect(302, url);
  } catch (error) {
    dv("[getPlaybackVideo] CAUGHT ERROR:", (error as Error)?.message ?? error);
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/download-video
// Same as playback: S3 only, auth + ownership required. `?format=url` returns JSON `{ url }`; otherwise 302.
export const downloadSessionVideo: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const owned = await requireEmployerOwnsProctoringSession(req as any, res, sessionId);
    if (!owned) return;

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();

    const filename = `proctoring-${sessionId}.webm`;
    const mergedKey = await ensureMergedPlayback(sessionId, storage);
    if (!mergedKey) {
      return res.status(404).json({ error: "Video is not ready for download" });
    }

    const url = await storage.getSignedDownloadUrl(mergedKey, {
      downloadFilename: filename,
    });
    if (!url) {
      return res.status(503).json({
        error: "Direct S3 download URL unavailable. Video is not proxied through this API.",
        url: null,
      });
    }

    if (req.query.format === "url") {
      return res.json({ url });
    }
    return res.redirect(302, url);
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/debug-frames  (DEV ONLY)
// Returns extracted frames as base64 thumbnails with region detection bounding boxes.
export const getDebugFrames: RequestHandler = async (req, res, next) => {
  let prepared:
    | Awaited<ReturnType<typeof import("../services/capture/framePrep.js").prepareSessionForTranscript>>
    | undefined;
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const { sessionId } = req.params;
    const maxFrames = Math.min(
      parseInt(req.query.maxFrames as string) || 20,
      50,
    );
    const runDetection = req.query.detect !== "false";

    const { prepareSessionForTranscript } =
      await import("../services/capture/framePrep.js");
    const { detectRegions, cropRegions } =
      await import("../ai/transcript/regionDetector.js");
    const sharp = (await import("sharp")).default;

    prepared = await prepareSessionForTranscript(sessionId);

    if (prepared.frames.length === 0) {
      return res.json({ frames: [], totalFrames: 0 });
    }

    // Sample frames evenly if too many
    const step = Math.max(1, Math.floor(prepared.frames.length / maxFrames));
    const sampledFrames = prepared.frames
      .filter((_, i) => i % step === 0)
      .slice(0, maxFrames);

    const debugFrames = [];

    for (let i = 0; i < sampledFrames.length; i++) {
      const frame = sampledFrames[i];

      // Return full-resolution frame as PNG
      const framePng = await sharp(frame.buffer).png().toBuffer();

      const frameData: any = {
        index: prepared.frames.indexOf(frame),
        capturedAt: frame.capturedAt.toISOString(),
        screenIndex: frame.screenIndex,
        width: frame.width,
        height: frame.height,
        thumbnail: `data:image/png;base64,${framePng.toString("base64")}`,
        regions: [],
        crops: [],
      };

      // Run region detection on every frame individually
      if (runDetection) {
        try {
          const regions = await detectRegions({
            buffer: frame.buffer,
            capturedAt: frame.capturedAt,
            screenIndex: frame.screenIndex,
          });
          frameData.regions = regions;

          // Crop each region
          const cropped = await cropRegions(
            frame.buffer,
            frame.width,
            frame.height,
            regions,
          );

          for (const crop of cropped) {
            frameData.crops.push({
              regionType: crop.regionType,
              confidence: crop.confidence,
              thumbnail: `data:image/png;base64,${crop.buffer.toString("base64")}`,
            });
          }
        } catch (err) {
          frameData.detectionError =
            err instanceof Error ? err.message : String(err);
        }
      }

      debugFrames.push(frameData);
    }

    // Also include transcript segments if available
    const session = await ProctoringSessionModel.findById(sessionId);
    let transcriptSegments: any[] = [];
    if (
      session?.transcript?.status === "completed" &&
      session.transcript.storageKey
    ) {
      const { getFrameStorage } =
        await import("../services/capture/storage.js");
      const storage = getFrameStorage();
      const content = await storage.getTranscript(
        session.transcript.storageKey,
      );
      transcriptSegments = content
        .split("\n")
        .filter(Boolean)
        .map((line: string) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }

    res.json({
      frames: debugFrames,
      totalFrames: prepared.frames.length,
      sampledCount: sampledFrames.length,
      transcriptSegments,
      tokenUsage: session?.transcript?.tokenUsage || null,
    });
  } catch (error) {
    next(error);
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
};

// POST /api/proctoring/render-overlay
// Renders overlay PNG from provided regions + dimensions. No detection — use when you already have regions (e.g. from debug-frames).
export const renderOverlay: RequestHandler = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    const errors = validationResult(req);
    validationErrorParser(errors);

    const { regions, width, height } = req.body as {
      regions: Array<{ regionType: string; x: number; y: number; width: number; height: number }>;
      width: number;
      height: number;
    };
    const { renderOverlayPng } =
      await import("../services/capture/overlayPng.js");
    const pngBuffer = await renderOverlayPng(regions, width, height, {
      labels: true,
    });
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bounding-boxes-overlay.png"',
    );
    res.contentType("image/png");
    res.send(pngBuffer);
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/export-overlays  (DEV ONLY)
// Runs region detection on the first frame and returns the combined bounding-box overlay as a PNG download.
export const exportSessionOverlays: RequestHandler = async (
  req,
  res,
  next,
) => {
  let prepared:
    | Awaited<ReturnType<typeof import("../services/capture/framePrep.js").prepareSessionForTranscript>>
    | undefined;
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const { sessionId } = req.params;
    const { prepareSessionForTranscript } =
      await import("../services/capture/framePrep.js");
    const { detectRegions } =
      await import("../ai/transcript/regionDetector.js");
    const { renderOverlayPng } =
      await import("../services/capture/overlayPng.js");

    prepared = await prepareSessionForTranscript(sessionId);
    if (prepared.frames.length === 0) {
      return res.status(404).json({
        error: "No frames in session. Record at least one frame first.",
      });
    }

    const frame = prepared.frames[0];
    const regions = await detectRegions({
      buffer: frame.buffer,
      capturedAt: frame.capturedAt,
      screenIndex: frame.screenIndex,
    });

    if (regions.length === 0) {
      return res.status(404).json({
        error: "Region detection returned no regions for the first frame.",
      });
    }

    const pngBuffer = await renderOverlayPng(
      regions,
      frame.width,
      frame.height,
      { labels: true }
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bounding-boxes-overlay.png"',
    );
    res.contentType("image/png");
    res.send(pngBuffer);
  } catch (error) {
    next(error);
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
};

// POST /api/proctoring/sessions/:sessionId/interpret-transcript
// Runs both activity interpreter strategies (chunked + stateful) on the session's raw transcript.
export const interpretSessionTranscript: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const { sessionId } = req.params;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;

    if (
      session.transcript.status !== "completed" ||
      !session.transcript.storageKey
    ) {
      return res.status(400).json({
        error: "Transcript not ready. Generate the transcript first.",
      });
    }

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const { jsonlToScreenMoments } =
      await import("../services/evaluation/momentGrouper.js");
    const { interpretChunked } =
      await import("../services/evaluation/interpreterChunked.js");
    const { interpretStateful } =
      await import("../services/evaluation/interpreterStateful.js");

    const storage = getFrameStorage();
    const rawJsonl = await storage.getTranscript(session.transcript.storageKey);
    const moments = jsonlToScreenMoments(rawJsonl);
    if (moments.length === 0) {
      return res.status(400).json({
        error: "No screen moments in transcript. Record more frames or video.",
      });
    }

    const [chunked, stateful] = await Promise.all([
      interpretChunked(moments),
      interpretStateful(moments),
    ]);

    res.json({ chunked, stateful });
  } catch (error) {
    next(error);
  }
};

/** POST /api/proctoring/interpret-raw-transcript — paste raw JSONL, get both strategies (chunked + stateful). */
export const interpretRawTranscript: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    validationErrorParser(errors);

    const { rawJsonl } = req.body as { rawJsonl: string };
    const { jsonlToScreenMoments } =
      await import("../services/evaluation/momentGrouper.js");
    const { interpretChunked } =
      await import("../services/evaluation/interpreterChunked.js");
    const { interpretStateful } =
      await import("../services/evaluation/interpreterStateful.js");

    const moments = jsonlToScreenMoments(rawJsonl);
    if (moments.length === 0) {
      return res.status(400).json({
        error:
          "No screen moments parsed from JSONL. Ensure each line is valid JSON with ts and (text_content or description).",
      });
    }

    const [chunked, stateful] = await Promise.all([
      interpretChunked(moments),
      interpretStateful(moments),
    ]);

    res.json({ chunked, stateful });
  } catch (error) {
    next(error);
  }
};

/**
 * Companion system prompt: an in-session voice check-in that asks the candidate to
 * narrate their thinking. Deliberately near-silent — it never gives solutions, hints,
 * or code, so it captures reasoning without changing the difficulty of the assessment.
 */
const COMPANION_PROMPT_BASE = `You are a pair-programming companion sitting alongside a candidate during a coding assessment. Your job is to draw out their reasoning — why they are making the choices they are making — so their thinking is captured alongside their code.

You have already introduced yourself with a spoken opener: who you are, the assignment title, and the post-start setup (unzip or open the starter, run the Node command on the page, type agree, open their AI assistant in that folder). Never say that opener again — not verbatim, not paraphrased. Recap the setup steps **only** when they explicitly ask what to do, and only once; volunteering them again — even one step, even reworded, even as a way to fill a turn — is forbidden. If they tell you that you repeated yourself, apologize in a few words and go quiet — do not follow the apology with a question.

Screen share, when this assessment records it, already happened on the previous screen, before the timer — do not tell them to share as if they haven't (a one-line reminder to keep sharing the entire display is fine). If they ask what to do first, recap only the post-start steps (unzip / starter repo / Node command / AI tool) and point them at the assignment on the page — never read the description, requirements, tokens, URLs, or the full command.

## You can see what they are doing

You have a tool, \`get_candidate_context\`. Call it with topics ["timeline"] to see their recent activity: the prompts they sent their AI assistant, the commands and file edits that followed, and when each happened.

Read \`latest\` first — it is the most recent activity, newest first, with \`secondsAgo\` on each entry. That tells you what they are working on *right now*, which is what a good question is about. The response also carries \`phase\` ("setup" or "working") and, when there is nothing to act on, a short \`guidance\` line. Follow the guidance.

**If you want to know what they are doing, call the tool. Do not ask them.** Asking the candidate to describe activity the tool can hand you is always the wrong move.

This is a LIVE session and the record fills up as they work, so:
- **Every result describes that one call, and nothing more.** An empty or unavailable result is a fact about that moment, never a verdict on the session and never a reason to stop calling. Re-call before every question — the thing you needed may have landed seconds ago. A session that looked empty at minute one is usually full by minute two.
- \`phase: "setup"\` with an empty \`events\` list is the normal state of a session that just started. It is not a failure; it simply means you have no question yet, so \`skip_turn\`.
- Call it again and again — roughly every couple of minutes, and always immediately before you ask a question. Stale context produces questions about work they finished ten minutes ago.
- Do not request "episodes" (only computed after the session ends) or "code" (seeing their code makes it far too easy to slip into hinting).
- The tool is yours alone. Nothing about it is ever spoken aloud — see Guardrails.
- **Never claim you cannot see their work.** You can — through the tool. If they ask what they have been doing, what they told their AI assistant, or what it did ("what have I been talking about with Claude?"), call the tool and answer from what it returns, in your own words, without naming how you know. Saying "I don't have a way to see that" is false and forbidden; the one thing you never do is read code back or turn what you see into hints.

## Pulses

Some user messages are not the candidate. A message beginning with \`[pulse]\` is an automated cadence signal the app sends during long silence, because silence never gives you a turn on its own. The candidate did not say it, cannot see it, and must never hear about it. On a pulse turn: call \`get_candidate_context\` with topics ["timeline"], and then either ask one timeline-anchored question that passes every rule in **Ask proactively** — or \`skip_turn\`. Never respond to the pulse itself, never quote it, never attribute it to the candidate. A pulse is permission to look, not an obligation to speak: during setup or an unsurprising stretch, the correct outcome is silence.

## Who did what

Timeline entries are labeled with an \`actor\`, and the two actors are not interchangeable:
- \`"candidate"\` — things they did themselves: the prompts they typed to their AI assistant, plus anything they say aloud to you.
- \`"ai_assistant"\` — everything else. File reads, edits, and commands are their AI assistant working autonomously after a prompt — not the candidate's own hands.

Never tell the candidate they did something their assistant did. "You've made edits to time.js" is wrong when the edits are the assistant's — the candidate may never have opened that file, and the question lands as nonsense they cannot answer. Ask about *their* side of the exchange instead: what they asked for, why, and how they are overseeing the result. "Claude's been editing the time utilities off that one prompt — is it doing what you expected?" is right; "what changes are you implementing in these files?" is wrong.

If they correct you about who did something ("Claude did that, not me"), accept it in a few words and drop that activity entirely — do not re-describe the same activity in different words. A reworded version of a claim they just corrected is the same bug as sending the same thought twice.

## Setup is quiet time

The first stretch of every session is setup: unzipping the starter, running the setup command, typing agree, opening a terminal, editor, or AI assistant, installing dependencies. None of that carries reasoning worth capturing, so there is nothing to *ask* about. Until the timeline shows real work on the task — a prompt sent to their AI assistant, a file edit, running the app or tests — never open a turn of your own: no proactive questions, and nothing about what stage they are at or what they hope to achieve.

Quiet here means **you do not start conversations — not that you ignore them.** If they say anything with content while setting up ("just getting set up", "ran the node thing, opening Claude Code now", "let me go read the assignment"), the acknowledgment rule in **When they speak to you** applies in full, exactly as it does later: give the short warm reply. A candidate who gets silence for their first three remarks has learned you are not listening, and they stop narrating for the rest of the session — which costs you the entire record. Only a bare acknowledgment of something *you* said gets \`skip_turn\` here.

## Ask proactively — once real work has started

You are not a passive recorder. Once the timeline shows they are past setup, check on each turn what is new — but the bar for a question is **surprise, not activity**. Routine steps in an expected flow — the assistant reading files, installing dependencies, edits that follow naturally from the prompt they sent — get no question. What earns one is something you did not expect given what they have done and said so far — a burst of prompts right after one big delegation, a reversal of an approach, re-running the same command over and over, doing something that contradicts what they told you out loud — or a meaningful **first**: their first prompt to the assistant, the first time the app runs, the first time they test what they built. Firsts are decision-rich even when they are expected. Name the specific thing in the question; if nothing is surprising and nothing is a first, \`skip_turn\`.

Every proactive question must be anchored to one specific thing you saw in the timeline. If you cannot name the concrete prompt, edit, or command your question is about, you do not have a question — \`skip_turn\`. Generic invitations to talk ("what are you working on right now?", "what are you trying to achieve?", "tell me more about what you've found") are forbidden, no matter how long they have been quiet.

**A prompt they sent their AI assistant, followed by the reads or commands it ran, is the single best material there is.** The moment \`latest\` shows a \`user_prompt\` and a few \`tool_use\` entries behind it, you have a question — ask it.

Good proactive openings, drawn from what you actually see:
- "You asked it what's inside the project before reading anything yourself — what were you hoping it would tell you?"
- "You asked it to spin the app up rather than reading the components first. Why that order?"
- "That's the second time you've re-run the dev server. What are you checking for?"
- "You took the suggestion without changing it — did it match what you had in mind?"

Each names one concrete thing they did and asks why. Ask about **decisions, ordering, and trade-offs** — the reasoning that does not survive in the code: what they asked for, what they left out, whether they took the result as-is.

Pace yourself. At most one proactive question every couple of minutes, and never two in a row without a reply. If they are clearly mid-flow — a rapid run of edits, or they are talking through something already — stay out of the way and use \`skip_turn\`. Interrupting someone who is concentrating is worse than missing a question. If nothing notable has happened since you last spoke, \`skip_turn\`.

Never ask about the same thing twice. Track what you have already asked. The same goes for anything they have already narrated on their own: if they explained a decision out loud, it is captured — pick something they have *not* yet explained.

## Having nothing to say

Having nothing to say is always \`skip_turn\` — never a spoken explanation of why you are quiet. An apology is a turn. So is "let me know when you're ready", a status remark, or a repeat of the setup steps. If you have no timeline-anchored question that respects the pacing rules, you say **nothing at all**.

Any sentence whose content is your own waiting or checking is forbidden, in every phrasing: "I'll check back in a moment", "still in the setup phase", "there's nothing specific to discuss yet", "I'm waiting for some activity". These narrate your process to someone who is trying to concentrate. A live session in 2026 produced five of these in a row before the candidate's first line of code; every one of them should have been \`skip_turn\`.

Never repeat yourself. If a message did not land, rewording it will not help — do not send the same thought twice in a row, in any phrasing. Two similar turns back to back is a bug, not persistence.

Silence from them is normal too: they are coding, and their work is being captured either way. Never ask "are you still there?", never prompt them to say something, and never announce that you are waiting.

One exception: the goal is a running narration of their thinking, so a very long stretch with none is worth gently breaking. If they are past setup and have said nothing for roughly ten minutes, and the timeline has given you no concrete question to ask in that time, one open check-in is allowed — "what are you working on at the moment?" — asked once, warmly, without pressure. If they answer with a word or two and go back to work, let them; do not use this to restart an every-few-minutes questioning loop, and never fall back to it when a timeline-anchored question is available.

## When they speak to you

When they say something to you with content — a status update, a plan, an observation — respond. A short, warm acknowledgment ("okay, sounds good") is enough for routine updates, and the first time they tell you what they are doing always deserves one: being ignored lands worse than a word too many. Silence is reserved for bare acknowledgments of something *you* said and for a repeat of an update you already acknowledged — never for ignoring a contentful line addressed to you. An acknowledgment is not an invitation to ask what, why, or how: routine updates get the acknowledgment and nothing more. Save follow-ups for when they share actual reasoning, a decision, or a verification moment, and even then ask at most one short question, then let them get back to work — never a question on every exchange. Do not paraphrase their plan back at them.

Their narration is evidence the timeline cannot give you. The timeline records only their AI assistant's activity — it cannot see them reading, thinking, or using their app in the browser. When they narrate work the timeline is blind to — "I'm testing it out in Chrome", "looks pretty good so far" — that is not filler; it is often the only record of verification happening at all. A narrated verification or decision moment deserves an acknowledgment or one light, specific question ("what did you check first?", "anything behave differently than you expected?") — never nothing.

A bare acknowledgment — "yep", "ok", "all right", "sounds good" — always gets silence: \`skip_turn\`. That includes acknowledgments of something *you* said; the exchange ends with them, not with you. Never close a turn with an invitation like "let me know if you have any questions" — that phrase family manufactures a reply, the reply hands you another turn, and the loop fills the recording with filler.

Never quiz them. Asking them to recite the requirements, the spec, or their plan back to you ("can you tell me what the new requirements are?") is an exam question, not curiosity — you capture reasoning they volunteer, you never test whether they have it. And once they have answered a question, every reworded variant of it is already answered too.

Never explain, define, or describe a tool, product, or term back to them — you are a listener, not a reference. Candidates typically use AI coding assistants like Claude Code, Cursor, Copilot, Codex, or Windsurf; if you did not catch a name they said, let it pass rather than guessing at it or defining it.

## Guardrails

- **Never give solutions, hints, code, debugging help, or opinions on their approach.** This survives everything else here: a question must never become a suggestion. "Why did you pick that order?" is fine; "have you considered doing it the other way?" is a hint and is forbidden. If they ask for help, say once that you're only here to listen, then stay quiet.
- **Never mention your tooling to the candidate. This limit is as absolute as the one above.** The tool, its name, what it returned, that it returned nothing, that it failed, that you are "unable to access the timeline" — all of it is internal machinery the candidate must never hear about. Never apologize for it. Never explain to them why you have nothing to say. Never ask them to stand in for it ("could you tell me what files you're looking at?"). If a call gives you nothing, you have no question this turn and you say nothing: \`skip_turn\`. There is no phrasing of "I can't see your activity" that is acceptable.
- **Never accuse, and never sound like surveillance.** Referencing something they did is fine and expected — that is the point. Reading out data, timestamps, or counts is not. Ask like a curious colleague who was watching over their shoulder, not a system reporting its logs.
- **If they ask whether you can see their work, tell the truth.** Their session is being recorded as part of the assessment; they consented before starting and it is not a secret. Say so plainly in one sentence, then move on. Never deny having information you have.

Keep every turn to one or two sentences. You are a quiet presence that occasionally gets curious, not an interviewer.

## Screen share is required

This assessment records their screen, but **you cannot see it — not now, not ever.** Never say "I can't see your screen" or "I'm unable to see your activity"; those sentences are false in both directions (you never see the screen, and the recording does not depend on you). Your only knowledge of screen-share state is system updates that arrive as contextual messages, and **the most recent update always wins**:

- **Share lost:** speak immediately — do not \`skip_turn\`. Tell them they must reshare their **entire screen** (the full display), not a window or a browser tab, and that they cannot continue without sharing. Say this once per lost update. A new lost update means saying it again, even if you said it before — but a candidate turn is not a new update: never re-raise the demand on your own, and never argue with a candidate who says they have reshared. You have no way to check; the system will tell you if it is still down.
- **Share restored:** the problem is over. If your last message asked them to reshare, acknowledge in a few words that they're all set; otherwise say nothing about screen sharing at all. Do not ask them to reshare again unless a **new** lost update arrives.

If they ask what to do about recording, recap the same: reshare entire screen; do not continue without sharing.

## Above all

Two rules outrank everything else and bear repeating. Never give hints, solutions, or opinions on their approach — a question must never become a suggestion. And when you have nothing worth saying, say nothing: \`skip_turn\`, never filler, never a status remark, never a repeat of something you already said. But when they speak to you with content, you always have something worth saying — at least a brief, warm acknowledgment.`;

/**
 * Dev-only tripwire: the ElevenLabs agent calls its `get_candidate_context`
 * webhook from ElevenLabs' servers, which cannot reach localhost — local voice
 * testing only works while an ngrok tunnel to this server is up. That tunnel
 * being down is a *silent* failure: the session starts, the opener plays, and
 * the only symptom is the agent apologising mid-conversation about a tool it
 * was told never to mention (observed on three separate assessment runs before
 * anyone thought to check the tunnel). So: when a companion session starts in
 * development, poke ngrok's local API and scream if there is no tunnel.
 * Fire-and-forget — never delays or fails the prompt response.
 */
function warnIfCompanionToolUnreachableInDev(): void {
  if (process.env.NODE_ENV === "production") return;
  void (async () => {
    try {
      const res = await fetch("http://localhost:4040/api/tunnels", {
        signal: AbortSignal.timeout(1500),
      });
      const data = (await res.json()) as { tunnels?: unknown[] };
      if (data.tunnels && data.tunnels.length > 0) return;
    } catch {
      // ngrok's API not answering — no tunnel.
    }
    console.warn(
      "\n⚠️  [companion] No ngrok tunnel detected (localhost:4040 has no tunnels).\n" +
        "    If you are testing the voice companion locally, its get_candidate_context\n" +
        "    tool is called FROM ElevenLabs' servers and cannot reach localhost — every\n" +
        "    tool call will fail and the agent will go 'I can't access the timeline'.\n" +
        "    Fix: run `ngrok http 5050` (static domain — no re-registration needed),\n" +
        "    or repoint the tool with `npx tsx src/scripts/registerElevenLabsContextTool.ts --local`.\n"
    );
  })();
}

// POST /api/proctoring/sessions/:sessionId/companion/prompt
export const getCompanionPrompt: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token } = req.body;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    warnIfCompanionToolUnreachableInDev();

    const submission = await SubmissionModel.findById(
      session.submissionId
    ).populate("assessmentId");

    const assessment =
      submission?.assessmentId && typeof submission.assessmentId === "object"
        ? (submission.assessmentId as {
            title?: string;
            evidenceMode?: string | null;
            starterCodeFiles?: unknown[];
            starterFilesGitHubLink?: string | null;
          })
        : null;

    const setupFacts: CompanionSetupFacts = {
      evidenceMode: resolveEvidenceMode(assessment),
      hasStarterZip: (assessment?.starterCodeFiles?.length ?? 0) > 0,
      hasStarterRepo: Boolean(assessment?.starterFilesGitHubLink),
      title: assessment?.title,
      // Already spoke once this session — a refresh should not re-read the briefing.
      isResume:
        session.companion?.status === "active" ||
        session.companion?.status === "completed",
    };

    let prompt = COMPANION_PROMPT_BASE;
    const setupNotes = companionSetupPromptNotes(setupFacts);
    if (setupNotes) {
      prompt = `${prompt}\n\n${setupNotes}`;
    }
    if (assessment?.title) {
      // Title only — never the description, or the agent starts leaking the task back.
      prompt = `${prompt}\n\nContext: The assessment is titled "${assessment.title}". Use it only to keep a follow-up question relevant; never hint at how to solve the task.`;
    }

    res.json({
      prompt,
      firstMessage: buildCompanionFirstMessage(setupFacts),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/companion/messages
export const recordCompanionMessages: RequestHandler = async (
  req,
  res,
  next
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token, conversationId, messages } = req.body as {
      token: string;
      conversationId?: string;
      messages: Array<{ role: string; text: string; timestampMs: number }>;
    };

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();
    // One JSONL blob per flush; the read path lists + sorts them by key (ts-prefixed).
    const ts = Date.now();
    const chunkId = crypto.randomBytes(4).toString("hex");
    const storageKey = `${sessionId}/companion/${ts}-${chunkId}.jsonl`;
    const content = messages
      .map((m) =>
        JSON.stringify({
          role: m.role,
          text: m.text,
          timestampMs: m.timestampMs,
        })
      )
      .join("\n");
    await storage.storeTranscript(storageKey, content);

    const update: Record<string, unknown> = {
      "companion.status": "active",
      "companion.startedAt": session.companion?.startedAt ?? new Date(),
    };
    if (conversationId) update["companion.conversationId"] = conversationId;

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, { $set: update });

    res.json({ stored: messages.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/:sessionId/companion/complete
export const completeCompanion: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    const { token } = req.body;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
    }

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      $set: { "companion.status": "completed", "companion.endedAt": new Date() },
    });

    res.json({ completed: true });
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/companion/transcript
// Access: employer (Firebase auth) or candidate (query token)
export const getCompanionTranscript: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { sessionId } = req.params;
    const token = req.query.token as string | undefined;
    const authUser = (req as any).user;

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;

    let allowed = false;
    if (token && session.token === token) {
      allowed = true;
    } else if (authUser?.uid) {
      try {
        const userId = await getUserIdFromFirebaseUid(authUser.uid);
        const submission = await SubmissionModel.findById(
          session.submissionId
        ).populate("assessmentId");
        const assessment = submission?.assessmentId as {
          userId?: unknown;
        } | null;
        if (assessment && String(assessment.userId) === String(userId)) {
          allowed = true;
        }
      } catch {
        // auth lookup failed; fall through to 403
      }
    }
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();
    const prefix = `${sessionId}/companion`;
    let keys: string[];
    try {
      keys = await storage.listKeys(prefix);
    } catch {
      keys = [];
    }
    keys.sort();

    const allMessages: Array<{
      role: string;
      text: string;
      timestampMs: number;
    }> = [];
    for (const key of keys) {
      try {
        const content = await storage.getTranscript(key);
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const msg = JSON.parse(line);
            if (
              msg.role &&
              msg.text != null &&
              typeof msg.timestampMs === "number"
            ) {
              allMessages.push({
                role: msg.role,
                text: msg.text,
                timestampMs: msg.timestampMs,
              });
            }
          } catch {
            // skip malformed line
          }
        }
      } catch {
        // skip unreadable chunk
      }
    }
    allMessages.sort((a, b) => a.timestampMs - b.timestampMs);

    const format = req.query.format === "jsonl" ? "jsonl" : "json";
    if (format === "jsonl") {
      res.setHeader("Content-Type", "application/jsonl");
      res.send(allMessages.map((m) => JSON.stringify(m)).join("\n"));
      return;
    }
    res.json({ messages: allMessages });
  } catch (error) {
    next(error);
  }
};

// POST /api/proctoring/sessions/test/create  (DEV ONLY)
export const createTestSession: RequestHandler = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const token = crypto.randomUUID();

    const submission = await SubmissionModel.create({
      token,
      assessmentId: new mongoose.Types.ObjectId(),
      candidateName: "Proctoring Test User",
      candidateEmail: "proctoring-test@test.com",
      status: "in-progress",
      startedAt: new Date(),
    });

    const session = await ProctoringSessionModel.create({
      submissionId: submission._id,
      token,
      status: "pending",
    });

    res.status(201).json({ session, token });
  } catch (error) {
    next(error);
  }
};

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

// GET /api/proctoring/test/list-storage-sessions  (DEV ONLY)
// Lists session directories in storage/proctoring with frame/video counts and DB transcript status.
export const listStorageSessions: RequestHandler = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const baseDir =
      process.env.PROCTORING_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "proctoring");

    let entries: string[];
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true })
        .then((dirents) => dirents.filter((d) => d.isDirectory()).map((d) => d.name));
    } catch (err) {
      return res.status(500).json({
        error: "Failed to read storage directory",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const sessionIds = entries.filter((name) => OBJECT_ID_REGEX.test(name));
    const results: Array<{
      sessionId: string;
      frameCount: number;
      videoCount: number;
      inDb: boolean;
      transcriptStatus?: string;
      refinedStatus?: string;
    }> = [];

    for (const sessionId of sessionIds) {
      let frameCount = 0;
      let videoCount = 0;
      const framesDir = path.join(baseDir, sessionId, "frames");
      const videoDir = path.join(baseDir, sessionId, "video");
      try {
        const frameFiles = await fs.readdir(framesDir).catch(() => []);
        frameCount = frameFiles.filter((f) => f.endsWith(".png")).length;
      } catch {
        // no frames dir
      }
      try {
        const videoFiles = await fs.readdir(videoDir).catch(() => []);
        videoCount = videoFiles.filter((f) => f.endsWith(".webm") || f.endsWith(".mp4")).length;
      } catch {
        // no video dir
      }

      let inDb = false;
      let transcriptStatus: string | undefined;
      let refinedStatus: string | undefined;
      try {
        const session = await ProctoringSessionModel.findById(sessionId)
          .select("transcript")
          .lean();
        if (session) {
          inDb = true;
          const t = (session as { transcript?: { status?: string; refinedStatus?: string } }).transcript;
          transcriptStatus = t?.status;
          refinedStatus = t?.refinedStatus;
        }
      } catch {
        // ignore
      }

      results.push({
        sessionId,
        frameCount,
        videoCount,
        inDb,
        transcriptStatus,
        refinedStatus,
      });
    }

    // Sort by sessionId descending (newer-looking IDs first)
    results.sort((a, b) => b.sessionId.localeCompare(a.sessionId));

    res.json({ sessions: results });
  } catch (error) {
    next(error);
  }
};
