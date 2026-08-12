/**
 * Workflow capture controller (hooks-first AI-collaboration capture).
 *
 * Ingest is written to be boring and forgiving: the capture kit runs on the
 * candidate's machine inside their AI tool's hook path, so anything slow or
 * fussy here degrades THEIR experience. Every write is idempotent (the kit
 * retries from an offline queue), oversized payloads are truncated rather than
 * rejected, and unknown fields are kept instead of validated away.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import mongoose from "mongoose";

import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
  type WorkflowEventType,
} from "../models/workflowCapture.js";
import fsp from "fs/promises";

import SubmissionModel from "../models/submission.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import { getFrameStorage } from "../services/capture/storage.js";
import {
  buildPlaybackVideo,
  videoChunkKey,
  offsetIntoVideo,
  nextVideoOffsetStart,
} from "../services/workflowCapture/video.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";

/** Per-event text cap. Long tool results get truncated, never dropped. */
const MAX_TEXT_CHARS = 20_000;
/** Per-file cap for the live code state. */
const MAX_FILE_CHARS = 100_000;
/** Max events accepted in one ingest batch. */
const MAX_BATCH = 200;

const DISCLOSURE_VERSION = "2026-08-12";

function truncate(
  value: string | null | undefined,
  max: number
): { text: string | null; truncated: boolean } {
  if (value == null) return { text: null, truncated: false };
  const str = typeof value === "string" ? value : String(value);
  if (str.length <= max) return { text: str, truncated: false };
  return { text: str.slice(0, max), truncated: true };
}

/** Bearer token from the capture kit → its session, or null. */
async function sessionFromCaptureToken(req: Request) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  return WorkflowCaptureSessionModel.findOne({ captureToken: token });
}

/**
 * POST /api/workflow-capture/sessions
 * Called by the capture kit during setup, after the candidate accepts the
 * on-screen disclosure. Returns the capture token exactly once.
 */
export async function createCaptureSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { submissionToken, candidateName, source, consentGranted, environment } =
      req.body ?? {};

    if (consentGranted !== true) {
      res.status(400).json({
        error: "consent_required",
        message:
          "Capture cannot start without explicit consent. The kit must show the disclosure and record acceptance.",
      });
      return;
    }

    let submissionId: mongoose.Types.ObjectId | undefined;
    if (submissionToken) {
      const submission = await SubmissionModel.findOne({ token: submissionToken })
        .select("_id candidateName")
        .lean();
      if (!submission) {
        res.status(404).json({ error: "submission_not_found" });
        return;
      }
      submissionId = (submission as any)._id;
    }

    const captureToken = crypto.randomBytes(32).toString("hex");
    const session = await WorkflowCaptureSessionModel.create({
      submissionId,
      submissionToken: submissionToken || undefined,
      candidateName: candidateName || undefined,
      source: source || "claude-code",
      captureToken,
      status: "active",
      consent: {
        granted: true,
        grantedAt: new Date(),
        disclosureVersion: DISCLOSURE_VERSION,
      },
      startedAt: new Date(),
      environment: environment || undefined,
    });

    res.status(201).json({
      sessionId: session._id.toString(),
      captureToken,
      disclosureVersion: DISCLOSURE_VERSION,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/workflow-capture/events   (Bearer capture token)
 * Batch ingest from the kit. Idempotent on (sessionId, seq) so the kit's
 * offline queue can retry freely.
 */
export async function ingestEvents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }
    if (session.status === "completed") {
      // Not an error: the kit may flush a late queue after submit.
      res.status(202).json({ accepted: 0, note: "session_completed" });
      return;
    }

    const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
    if (incoming.length === 0) {
      res.status(200).json({ accepted: 0 });
      return;
    }
    const batch = incoming.slice(0, MAX_BATCH);

    const docs: Record<string, unknown>[] = [];
    let promptCount = 0;
    let toolUseCount = 0;
    let payloadBytes = 0;
    const fileUpdates: Array<{ path: string; content: string | null }> = [];

    for (const raw of batch) {
      const type = String(raw?.type || "") as WorkflowEventType;
      if (!type) continue;

      const { text, truncated } = truncate(raw?.text, MAX_TEXT_CHARS);
      const at = raw?.at ? new Date(raw.at) : new Date();
      const seq = Number.isFinite(raw?.seq) ? Number(raw.seq) : Date.now();

      // Keep the structured remainder, capped by JSON size.
      let payload: Record<string, unknown> | null = null;
      let payloadTruncated = false;
      if (raw?.payload && typeof raw.payload === "object") {
        const asJson = JSON.stringify(raw.payload);
        if (asJson.length > MAX_TEXT_CHARS) {
          payload = { _truncated: true, _preview: asJson.slice(0, MAX_TEXT_CHARS) };
          payloadTruncated = true;
        } else {
          payload = raw.payload as Record<string, unknown>;
        }
        payloadBytes += Math.min(asJson.length, MAX_TEXT_CHARS);
      }
      payloadBytes += text?.length ?? 0;

      if (type === "user_prompt") promptCount++;
      if (type === "tool_use") toolUseCount++;

      // A Write tool call carries the full new contents — that is live code state.
      const toolName = raw?.toolName ? String(raw.toolName) : null;
      if (type === "tool_use" && toolName && /^(Write|Edit|MultiEdit)$/i.test(toolName)) {
        const input = (raw?.payload as any)?.tool_input ?? (raw?.payload as any)?.input;
        const filePath = input?.file_path ?? input?.path;
        if (typeof filePath === "string" && filePath.trim()) {
          fileUpdates.push({
            path: filePath.trim(),
            // Edit/MultiEdit only carry a diff; leave content null and let the
            // kit's snapshot fill it in rather than storing a partial file.
            content: typeof input?.content === "string" ? input.content : null,
          });
        }
      }

      docs.push({
        sessionId: session._id,
        type,
        at,
        seq,
        toolSessionId: raw?.toolSessionId ? String(raw.toolSessionId) : null,
        toolName,
        text,
        payload,
        truncated: truncated || payloadTruncated,
        cwd: raw?.cwd ? String(raw.cwd) : null,
        gitBranch: raw?.gitBranch ? String(raw.gitBranch) : null,
      });
    }

    let accepted = 0;
    if (docs.length > 0) {
      try {
        const inserted = await WorkflowEventModel.insertMany(docs, {
          ordered: false,
        });
        accepted = inserted.length;
      } catch (err: any) {
        // Duplicate (sessionId, seq) means the kit retried — count the rest.
        if (err?.writeErrors || err?.code === 11000) {
          accepted = (err.insertedDocs?.length as number) ?? 0;
        } else {
          throw err;
        }
      }
    }

    await applyFileUpdates(session._id, fileUpdates, "agent");

    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      {
        $set: { lastEventAt: new Date(), status: "active" },
        $inc: {
          "stats.totalEvents": accepted,
          "stats.promptCount": promptCount,
          "stats.toolUseCount": toolUseCount,
          "stats.payloadBytes": payloadBytes,
        },
      }
    );

    res.status(200).json({ accepted });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/workflow-capture/snapshot   (Bearer capture token)
 * Periodic file snapshot from the kit. Catches work the agent did not do —
 * hand-edited files, `git` operations, anything outside the tool's Write path.
 */
export async function ingestSnapshot(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }

    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const updates = files
      .filter((f: any) => typeof f?.path === "string" && f.path.trim())
      .map((f: any) => ({
        path: String(f.path).trim(),
        content: typeof f.content === "string" ? f.content : null,
      }));

    await applyFileUpdates(session._id, updates, "snapshot");
    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      { $set: { lastEventAt: new Date() } }
    );

    res.status(200).json({ files: updates.length });
  } catch (error) {
    next(error);
  }
}

async function applyFileUpdates(
  sessionId: mongoose.Types.ObjectId,
  updates: Array<{ path: string; content: string | null }>,
  origin: "agent" | "snapshot"
): Promise<void> {
  if (updates.length === 0) return;
  const ops = updates.map(({ path, content }) => {
    const { text, truncated } = truncate(content, MAX_FILE_CHARS);
    const set: Record<string, unknown> = {
      origin,
      truncated,
      updatedAt: new Date(),
    };
    // Never overwrite known contents with null (Edit events carry only a diff).
    if (text != null) {
      set.content = text;
      set.sizeBytes = text.length;
    }
    return {
      updateOne: {
        filter: { sessionId, path },
        update: { $set: set, $inc: { revision: 1 } },
        upsert: true,
      },
    };
  });
  await WorkflowFileStateModel.bulkWrite(ops, { ordered: false });
}

/**
 * POST /api/workflow-capture/complete   (Bearer capture token)
 */
export async function completeCaptureSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }
    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: "completed", completedAt: new Date() } }
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Align captured events to the submission's screen recording, if one exists.
 *
 * Both records are wall-clock stamped, so the offset is just
 * `event.at - captureStartedAt`. Events outside the recording window get a
 * null offset rather than a bogus seek target (a candidate can start their
 * agent before granting screen consent, or keep working after it stops).
 */
async function resolveVideoSync(
  submissionId: mongoose.Types.ObjectId | undefined,
  events: any[]
): Promise<{ meta: Record<string, unknown>; events: any[] } | null> {
  if (!submissionId) return null;

  const proctoring: any = await ProctoringSessionModel.findOne({ submissionId })
    .select("stats.captureStartedAt stats.captureEndedAt mergedVideo")
    .lean();
  const startedAt = proctoring?.stats?.captureStartedAt;
  if (!startedAt) return null;

  const startMs = new Date(startedAt).getTime();
  const endMs = proctoring?.stats?.captureEndedAt
    ? new Date(proctoring.stats.captureEndedAt).getTime()
    : null;

  const stamped = events.map((e) => {
    const atMs = new Date(e.at).getTime();
    const offset = (atMs - startMs) / 1000;
    const inWindow = offset >= 0 && (endMs == null || atMs <= endMs);
    return { ...e, videoOffsetSeconds: inWindow ? Number(offset.toFixed(2)) : null };
  });

  return {
    events: stamped,
    meta: {
      available: proctoring?.mergedVideo?.status === "ready",
      status: proctoring?.mergedVideo?.status ?? "not_started",
      durationSeconds: proctoring?.mergedVideo?.durationSeconds ?? null,
      captureStartedAt: startedAt,
      captureEndedAt: proctoring?.stats?.captureEndedAt ?? null,
      alignedEvents: stamped.filter((e) => e.videoOffsetSeconds != null).length,
    },
  };
}

/**
 * GET /api/workflow-capture/me   (Bearer capture token)
 * The candidate's own record of what we captured about them. This is a
 * transparency feature, not a debug route: the disclosure promises they can see
 * exactly what was collected, and this is how that promise is kept.
 */
export async function getOwnCaptureRecord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }

    const events = await WorkflowEventModel.find({ sessionId: session._id })
      .sort({ seq: 1 })
      .lean();
    const files = await WorkflowFileStateModel.find({ sessionId: session._id })
      .sort({ path: 1 })
      .select("path sizeBytes origin revision updatedAt")
      .lean();

    res.status(200).json({
      sessionId: session._id.toString(),
      status: session.status,
      startedAt: session.startedAt,
      lastEventAt: session.lastEventAt,
      stats: session.stats,
      events: events.map((e: any) => ({
        seq: e.seq,
        at: e.at,
        type: e.type,
        tool: e.toolName,
        text: e.text,
        truncated: e.truncated,
      })),
      files,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/workflow-capture/video/start   (Bearer capture token)
 * Marks the sync origin. Everything else about video alignment derives from
 * this instant, so it is recorded server-side rather than trusting the client.
 */
export async function startVideo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }
    const startedAt = new Date();
    const segments = (session.video?.segments ?? []) as any[];
    const resuming = segments.length > 0;

    // Resuming appends a segment and keeps existing chunks. Wiping them here
    // would destroy everything recorded before an interruption — and screen
    // shares end for entirely mundane reasons (switching apps, closing the
    // shared tab), so interruptions are expected, not exceptional.
    const update: Record<string, unknown> = {
      "video.status": "recording",
      "video.endedAt": null,
      // Force a rebuild: the cached playback file no longer covers everything.
      "video.mergedKey": null,
      "video.mergedSizeBytes": 0,
      "video.error": null,
    };
    if (!resuming) update["video.startedAt"] = startedAt;

    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      {
        $set: update,
        $push: {
          "video.segments": {
            wallStartedAt: startedAt,
            wallEndedAt: null,
            videoOffsetStart: nextVideoOffsetStart(segments),
            endReason: null,
          },
        },
      }
    );
    res.status(200).json({ startedAt, resuming, segmentIndex: segments.length });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/workflow-capture/video/chunk   (Bearer capture token, multipart)
 * One MediaRecorder timeslice. Chunks land on disk via multer, never on the heap.
 */
export async function uploadVideoChunk(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const file = (req as any).file;
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }
    if (!file) {
      res.status(400).json({ error: "no_chunk" });
      return;
    }

    const index = (session.video?.chunks?.length as number) ?? 0;
    const key = videoChunkKey(session._id.toString(), index);
    const buffer = await fsp.readFile(file.path);
    await getFrameStorage().storeVideoChunk(key, buffer);

    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      {
        $push: {
          "video.chunks": {
            storageKey: key,
            startTime: new Date(),
            sizeBytes: buffer.length,
          },
        },
      }
    );
    res.status(200).json({ index, sizeBytes: buffer.length });
  } catch (error) {
    next(error);
  } finally {
    if (file?.path) await fsp.unlink(file.path).catch(() => {});
  }
}

/**
 * POST /api/workflow-capture/video/stop   (Bearer capture token)
 */
export async function stopVideo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromCaptureToken(req);
    if (!session) {
      res.status(401).json({ error: "invalid_capture_token" });
      return;
    }
    // Why a recording stopped is diagnostic gold — "the video randomly stopped"
    // is unactionable, "share ended by browser" is not.
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "manual";
    const endedAt = new Date();
    const segments = (session.video?.segments ?? []) as any[];
    const openIndex = segments.findIndex((s: any) => !s.wallEndedAt);

    const update: Record<string, unknown> = {
      "video.status": "ready",
      "video.endedAt": endedAt,
    };
    if (openIndex >= 0) {
      update[`video.segments.${openIndex}.wallEndedAt`] = endedAt;
      update[`video.segments.${openIndex}.endReason`] = reason;
    }

    await WorkflowCaptureSessionModel.updateOne(
      { _id: session._id },
      { $set: update }
    );
    res.status(200).json({ ok: true, reason });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/workflow-capture/sessions/:id/video
 * Streams the merged recording with Range support so the player can seek.
 * Dev-open like the tester routes; production review goes through the
 * authenticated session endpoint.
 */
export async function streamSessionVideo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const built = await buildPlaybackVideo(req.params.id);
    if (!built) {
      res.status(404).json({ error: "no_video" });
      return;
    }

    const storage = getFrameStorage();
    const size = built.sizeBytes || null;
    const range = req.headers.range;

    if (range && size) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : size - 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "video/webm");
      const stream = await storage.openReadStream(built.key, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Accept-Ranges", "bytes");
    if (size) res.setHeader("Content-Length", String(size));
    const stream = await storage.openReadStream(built.key);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/workflow-capture/dev/data   (development only)
 * Backs the live tester page: recent sessions plus the full record of one of
 * them, with no auth. Gated to non-production in the route layer AND here —
 * this returns captured prompts, so a mis-mounted route must fail closed.
 */
export async function getDevTesterData(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const sessions = await WorkflowCaptureSessionModel.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .select("candidateName status stats createdAt")
      .lean();

    const requested = (req.query.sessionId as string) || null;
    const currentId = requested || (sessions[0] as any)?._id?.toString() || null;

    let current: Record<string, unknown> | null = null;
    if (currentId) {
      const session: any = await WorkflowCaptureSessionModel.findById(currentId).lean();
      if (session) {
        const events = await WorkflowEventModel.find({ sessionId: session._id })
          .sort({ seq: 1 })
          .limit(500)
          .lean();
        const files = await WorkflowFileStateModel.find({ sessionId: session._id })
          .sort({ path: 1 })
          .select("path sizeBytes origin revision updatedAt")
          .lean();
        const vid = session.video || {};
        current = {
          sessionId: session._id.toString(),
          status: session.status,
          // Dev-only: the tester page needs this to upload video chunks as the
          // session. Never returned by any non-dev route.
          captureToken: session.captureToken,
          stats: session.stats,
          events: events.map((e: any) => ({
            at: e.at,
            type: e.type,
            tool: e.toolName,
            text: e.text,
            // Position in the merged recording, or null when the event fell
            // outside every recorded segment (before start, after stop, or in
            // a gap where the share was interrupted).
            videoOffsetSeconds: offsetIntoVideo(e.at, vid.segments),
          })),
          files,
          video: {
            status: vid.status || "not_started",
            startedAt: vid.startedAt || null,
            endedAt: vid.endedAt || null,
            chunkCount: (vid.chunks || []).length,
            hasPlayback: (vid.chunks || []).length > 0,
            segments: (vid.segments || []).map((s: any) => ({
              wallStartedAt: s.wallStartedAt,
              wallEndedAt: s.wallEndedAt,
              videoOffsetStart: s.videoOffsetStart,
              endReason: s.endReason,
            })),
            totalRecordedSeconds: nextVideoOffsetStart(vid.segments || []),
          },
        };
      }
    }

    res.status(200).json({
      sessions: sessions.map((s: any) => ({
        id: s._id.toString(),
        candidateName: s.candidateName,
        status: s.status,
        eventCount: s.stats?.totalEvents ?? 0,
        createdAt: s.createdAt,
      })),
      current,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/workflow-capture/agent-context?submissionToken=...&sinceSeq=...
 * Real-time context for the live interviewer agent: the recent conversation
 * plus the current state of the code. Shares the ElevenLabs agent secret with
 * /api/agent-tools. Budgeted so the agent gets a usable prompt, not a dump.
 */
export async function getAgentContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const expected = process.env.AGENT_SECRET;
    if (expected) {
      const provided = req.headers["x-agent-secret"];
      if (provided !== expected) {
        res.status(401).json({ error: "invalid_agent_secret" });
        return;
      }
    }

    const { submissionToken, sessionId } = req.query as Record<string, string>;
    const query = sessionId
      ? { _id: sessionId }
      : submissionToken
        ? { submissionToken }
        : null;
    if (!query) {
      res.status(400).json({ error: "submissionToken_or_sessionId_required" });
      return;
    }

    const session = await WorkflowCaptureSessionModel.findOne(query as any)
      .sort({ createdAt: -1 })
      .lean();
    if (!session) {
      res.status(404).json({ error: "capture_session_not_found" });
      return;
    }

    const maxTurns = Math.min(Number(req.query.maxTurns) || 40, 200);
    const events = await WorkflowEventModel.find({
      sessionId: (session as any)._id,
      type: { $in: ["user_prompt", "assistant_message", "tool_use"] },
    })
      .sort({ seq: -1 })
      .limit(maxTurns)
      .lean();

    const files = await WorkflowFileStateModel.find({
      sessionId: (session as any)._id,
    })
      .sort({ updatedAt: -1 })
      .limit(40)
      .select("path sizeBytes updatedAt origin truncated")
      .lean();

    res.status(200).json({
      sessionId: (session as any)._id.toString(),
      status: (session as any).status,
      startedAt: (session as any).startedAt,
      lastEventAt: (session as any).lastEventAt,
      stats: (session as any).stats,
      // Chronological for the agent, even though we queried newest-first.
      recentActivity: events.reverse().map((e: any) => ({
        at: e.at,
        type: e.type,
        tool: e.toolName,
        text: e.text,
      })),
      files: files.map((f: any) => ({
        path: f.path,
        sizeBytes: f.sizeBytes,
        updatedAt: f.updatedAt,
        origin: f.origin,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/workflow-capture/sessions/:id   (employer auth)
 * Full timeline for review. Employer must own the linked assessment.
 */
export async function getCaptureSessionForReview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const uid = (req as any).user?.uid || req.body?.uid;
    if (!uid) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const userId = await getUserIdFromFirebaseUid(uid);
    const session = await WorkflowCaptureSessionModel.findById(req.params.id).lean();
    if (!session) {
      res.status(404).json({ error: "capture_session_not_found" });
      return;
    }

    if ((session as any).submissionId) {
      const submission = await SubmissionModel.findById((session as any).submissionId)
        .populate("assessmentId")
        .lean();
      const ownerId = (submission as any)?.assessmentId?.userId?.toString();
      if (ownerId && ownerId !== userId.toString()) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }

    const events = await WorkflowEventModel.find({ sessionId: (session as any)._id })
      .sort({ seq: 1 })
      .lean();
    const files = await WorkflowFileStateModel.find({
      sessionId: (session as any)._id,
    })
      .sort({ path: 1 })
      .lean();

    // Video sync: when the same submission also has a screen recording, stamp
    // each event with its offset into that recording. The reviewer can then
    // click a prompt and jump the player to the moment it happened — video for
    // human eyes, hook stream for the analysis. No OCR involved.
    const video = await resolveVideoSync((session as any).submissionId, events);

    const { captureToken, ...safeSession } = session as any;
    res.status(200).json({
      session: safeSession,
      events: video ? video.events : events,
      files,
      video: video ? video.meta : null,
    });
  } catch (error) {
    next(error);
  }
}
