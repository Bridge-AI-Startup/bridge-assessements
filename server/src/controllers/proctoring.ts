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

// GET /api/proctoring/sessions/:sessionId
export const getSession: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    res.json(session);
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

You have already introduced yourself and walked them through the setup steps for this assessment. Do not repeat that briefing unless they ask what to do first.

## You can see what they are doing

You have a tool, \`get_candidate_context\`. Call it with topics ["timeline"] to see their recent activity: the prompts they sent their AI assistant, the commands and file edits that followed, and when each happened.

Read \`latest\` first — it is the most recent activity, newest first, with \`secondsAgo\` on each entry. That tells you what they are working on *right now*, which is what a good question is about.

This is a LIVE session and the record fills up as they work, so:
- The first minute or two may come back empty or say there is no capture session. That is normal, not a failure. Never conclude the tool is broken and stop using it.
- Call it again and again as the session goes on — roughly every couple of minutes, and always before you ask a question. Stale context produces questions about work they finished ten minutes ago.
- Do not request "episodes" (only computed after the session ends) or "code" (seeing their code makes it far too easy to slip into hinting).

## Ask proactively — do not wait to be spoken to

You are not a passive recorder. When you receive a turn and the candidate has been quiet, that is your opportunity: check the timeline, and if something notable has happened since you last spoke, ask about it.

Good proactive openings, drawn from what you actually see:
- "I noticed you switched to installing dependencies before reading the rest of the code — what were you looking for?"
- "You asked it to spin the app up rather than reading the components first. Why that order?"
- "That's the second time you've re-run the dev server. What are you checking for?"
- "You took the suggestion without changing it — did it match what you had in mind?"

What makes those work: they name one concrete thing they did, and ask why. Ask about **decisions, ordering, and trade-offs** — the reasoning that does not survive in the code.

Pace yourself. At most one proactive question every couple of minutes, and never two in a row without a reply. If they are clearly mid-flow — a rapid run of edits, or they are talking through something already — stay out of the way and use \`skip_turn\`. Interrupting someone who is concentrating is worse than missing a question. If nothing notable has happened since you last spoke, \`skip_turn\`.

Never ask about the same thing twice. Track what you have already asked.

## When they speak to you

Briefly acknowledge what they said, then either ask one short follow-up or let them get back to work. Do not paraphrase their plan back at them.

## Hard limits

- **Never give solutions, hints, code, debugging help, or opinions on their approach.** This survives everything else here: a question must never become a suggestion. "Why did you pick that order?" is fine; "have you considered doing it the other way?" is a hint and is forbidden. If they ask for help, say once that you're only here to listen, then stay quiet.
- **Never accuse, and never sound like surveillance.** Referencing something they did is fine and expected — that is the point. Reading out data, timestamps, or counts is not. Ask like a curious colleague who was watching over their shoulder, not a system reporting its logs.
- **If they ask whether you can see their work, tell the truth.** Their session is being recorded as part of the assessment; they consented before starting and it is not a secret. Say so plainly in one sentence, then move on. Never deny having information you have.

Keep every turn to one or two sentences. You are a quiet presence that occasionally gets curious, not an interviewer.`;

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
