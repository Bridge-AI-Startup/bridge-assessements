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
import { storeFrame, storeVideoChunk } from "../services/capture/frameStorage.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";

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
    if (session.status !== "active") throw ProctoringError.SESSION_NOT_ACTIVE;

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
export const uploadVideoChunk: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No video chunk provided" });
    }

    const token = req.body.token;
    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) throw ProctoringError.SESSION_NOT_FOUND;
    if (session.token !== token) {
      return res.status(403).json({ error: "Invalid token" });
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

    const result = await storeVideoChunk(sessionId, file.buffer, {
      screenIndex: parseInt(req.body.screenIndex) || 0,
      startTime,
      endTime,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/** Resolve ordered list of video chunk storage keys for a session (screen 0). */
async function resolveSessionVideoChunkKeys(
  sessionId: string,
  session: { videoChunks?: unknown[] } | null,
  storage: { listKeys: (prefix: string) => Promise<string[]>; getVideoChunk: (key: string) => Promise<Buffer> }
): Promise<{ storageKey: string }[]> {
  let chunks: { storageKey: string }[] = [];
  dv("[resolveSessionVideoChunkKeys] sessionId =", sessionId, "session?.videoChunks?.length =", session?.videoChunks?.length ?? 0);

  if (session?.videoChunks?.length) {
    dv("[resolveSessionVideoChunkKeys] using DB videoChunks");
    const byScreen = new Map<number, { storageKey: string; startTime: Date }[]>();
    for (const ch of session.videoChunks as { storageKey: string; startTime: Date; screenIndex?: number }[]) {
      const screenIndex = ch.screenIndex ?? 0;
      if (!byScreen.has(screenIndex)) byScreen.set(screenIndex, []);
      byScreen.get(screenIndex)!.push({
        storageKey: ch.storageKey,
        startTime: new Date(ch.startTime),
      });
    }
    const screen0 = byScreen.get(0) ?? byScreen.get(Math.min(...byScreen.keys()));
    if (screen0) {
      screen0.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      chunks = screen0;
    }
    dv("[resolveSessionVideoChunkKeys] from DB: chunk count =", chunks.length, "first 3 keys =", chunks.slice(0, 3).map((c) => c.storageKey));
  }

  if (chunks.length === 0) {
    const prefix = `${sessionId}/video`;
    dv("[resolveSessionVideoChunkKeys] no DB chunks, listing storage prefix =", prefix);
    const keys = await storage.listKeys(prefix);
    const webmKeys = keys.filter((k) => k.endsWith(".webm"));
    dv("[resolveSessionVideoChunkKeys] listKeys returned", keys.length, "keys, webmKeys =", webmKeys.length, "sample =", webmKeys.slice(0, 3));
    if (webmKeys.length === 0) return [];
    const withMeta = webmKeys.map((key) => {
      const name = key.split("/").pop() || "";
      const [tsStr, screenStr] = name.replace(".webm", "").split("-");
      return {
        storageKey: key,
        ts: parseInt(tsStr, 10) || 0,
        screenIndex: parseInt(screenStr, 10) || 0,
      };
    });
    const screen0Keys = withMeta.filter((m) => m.screenIndex === 0);
    const toUse = screen0Keys.length ? screen0Keys : withMeta;
    toUse.sort((a, b) => a.ts - b.ts);
    chunks = toUse.map((m) => ({ storageKey: m.storageKey }));
  }

  return chunks;
}

/** Load and optionally re-mux session video. Works for in-DB videoChunks or storage-only listKeys (existing and new). */
async function getSessionVideoBuffer(
  sessionId: string,
  session: { videoChunks?: unknown[] } | null,
  storage: { listKeys: (prefix: string) => Promise<string[]>; getVideoChunk: (key: string) => Promise<Buffer> }
): Promise<{ buffer: Buffer; remuxed: boolean } | null> {
  dv("[getSessionVideoBuffer] sessionId =", sessionId);
  const chunks = await resolveSessionVideoChunkKeys(sessionId, session, storage);
  if (chunks.length === 0) {
    dv("[getSessionVideoBuffer] no chunks resolved, returning null");
    return null;
  }
  dv("[getSessionVideoBuffer] loading", chunks.length, "chunks from storage");
  const buffers: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    try {
      const buf = await storage.getVideoChunk(c.storageKey);
      buffers.push(buf);
      dv("[getSessionVideoBuffer] chunk", i + 1, "/", chunks.length, "key =", c.storageKey, "size =", buf.length);
    } catch (err) {
      dv("[getSessionVideoBuffer] FAILED to read chunk", i + 1, "key =", c.storageKey, "error =", (err as Error)?.message ?? err);
      throw err;
    }
  }
  const merged = Buffer.concat(buffers);
  dv("[getSessionVideoBuffer] merged size =", merged.length);

  const { remuxWebM } = await import("../services/capture/playbackRemux.js");
  const remuxed = await remuxWebM(merged);
  dv("[getSessionVideoBuffer] remuxed =", remuxed != null, "final buffer length =", (remuxed ?? merged).length);
  return {
    buffer: remuxed ?? merged,
    remuxed: remuxed != null,
  };
}

// GET /api/proctoring/sessions/:sessionId/playback-video
// Returns re-muxed WebM for in-page playback (correct duration). Auth required; employer must own the submission.
export const getPlaybackVideo: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { sessionId } = req.params;
    dv("[getPlaybackVideo] step 1: param sessionId =", sessionId, "type:", typeof sessionId);
    const uid = (req as any).user?.uid;
    if (!uid) {
      dv("[getPlaybackVideo] step 2: no uid, returning 401");
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = await ProctoringSessionModel.findById(sessionId);
    if (!session) {
      dv("[getPlaybackVideo] step 3: session NOT FOUND for sessionId:", sessionId);
      throw ProctoringError.SESSION_NOT_FOUND;
    }
    dv("[getPlaybackVideo] step 3: session FOUND. session.submissionId =", session.submissionId, "type:", typeof session.submissionId);

    const submission = await SubmissionModel.findById(session.submissionId);
    if (!submission) {
      dv("[getPlaybackVideo] step 4: submission NOT FOUND for session.submissionId:", session.submissionId);
      throw ProctoringError.SESSION_NOT_FOUND;
    }
    const assessment = await AssessmentModel.findById(submission.assessmentId);
    if (!assessment) {
      dv("[getPlaybackVideo] step 4: assessment NOT FOUND for submission.assessmentId:", submission.assessmentId);
      return res.status(403).json({ error: "Access denied to this session" });
    }
    const userId = await getUserIdFromFirebaseUid(uid);
    const assessmentOwnerId = assessment.userId?.toString?.() ?? assessment.userId;
    dv("[getPlaybackVideo] step 4: assessment.userId =", assessment.userId, "current userId =", userId, "match =", assessmentOwnerId === userId?.toString());
    if (!userId || assessmentOwnerId !== userId.toString()) {
      dv("[getPlaybackVideo] step 4: access DENIED (userId mismatch), returning 403");
      return res.status(403).json({ error: "Access denied to this session" });
    }

    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();
    dv("[getPlaybackVideo] step 5: calling getSessionVideoBuffer");
    const result = await getSessionVideoBuffer(sessionId, session, storage);
    if (!result) {
      dv("[getPlaybackVideo] step 6: getSessionVideoBuffer returned null, returning 404");
      return res.status(404).json({ error: "No video chunks found for this session" });
    }
    dv("[getPlaybackVideo] step 6: sending video buffer length =", result.buffer.length);
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Disposition", "inline");
    res.send(result.buffer);
  } catch (error) {
    dv("[getPlaybackVideo] CAUGHT ERROR:", (error as Error)?.message ?? error);
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/download-video
// Returns re-muxed WebM for the session (screen 0) so downloaded file has correct duration. Same pipeline as playback.
export const downloadSessionVideo: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { getFrameStorage } = await import("../services/capture/storage.js");
    const storage = getFrameStorage();

    const session = await ProctoringSessionModel.findById(sessionId);
    const result = await getSessionVideoBuffer(sessionId, session, storage);

    if (!result) {
      return res.status(404).json({ error: "No video chunks found for this session" });
    }

    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Disposition", `attachment; filename="proctoring-${sessionId}.webm"`);
    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
};

// GET /api/proctoring/sessions/:sessionId/debug-frames  (DEV ONLY)
// Returns extracted frames as base64 thumbnails with region detection bounding boxes.
export const getDebugFrames: RequestHandler = async (req, res, next) => {
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

    const prepared = await prepareSessionForTranscript(sessionId);

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

    const prepared = await prepareSessionForTranscript(sessionId);
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
