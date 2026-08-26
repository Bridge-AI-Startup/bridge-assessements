/**
 * Dev-lab handlers for the workflow-capture tester page.
 *
 * Every handler re-checks NODE_ENV. The route layer already refuses to mount
 * these in production, but they return capture tokens, raw prompts and code —
 * a mis-mounted route must fail closed rather than rely on one guard.
 */

import type { Request, Response, NextFunction } from "express";

import {
  STAGE_KEYS,
  buildLabSnapshot,
  getStageResult,
  listLabSessions,
  readLabFile,
  startStage,
  type StageKey,
} from "../services/workflowCapture/devLab.js";

function devOnly(res: Response): boolean {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "not_found" });
    return true;
  }
  return false;
}

/**
 * GET /api/workflow-capture/dev/data
 * The page's 2s poll: session list plus everything deterministic about one
 * session. `sinceSeq` makes the event stream incremental so a long session
 * does not re-send thousands of payloads twice a second.
 */
export async function getLabData(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (devOnly(res)) return;

    const sessions = await listLabSessions();
    const requested = (req.query.sessionId as string) || null;
    const currentId = requested || sessions[0]?.id || null;
    if (!currentId) {
      res.status(200).json({ sessions, current: null });
      return;
    }

    const sinceSeqRaw = req.query.sinceSeq;
    const current = await buildLabSnapshot(currentId, {
      sinceSeq: sinceSeqRaw != null ? Number(sinceSeqRaw) : undefined,
      includeTimeline: req.query.timeline === "1",
    });
    res.status(200).json({ sessions, current });
  } catch (error) {
    next(error);
  }
}

/** GET /api/workflow-capture/dev/file?sessionId=&path= — one captured file. */
export async function getLabFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (devOnly(res)) return;
    const sessionId = String(req.query.sessionId || "");
    const path = String(req.query.path || "");
    if (!sessionId || !path) {
      res.status(400).json({ error: "sessionId_and_path_required" });
      return;
    }
    const file = await readLabFile(sessionId, path);
    if (!file) {
      res.status(404).json({ error: "file_not_found" });
      return;
    }
    res.status(200).json(file);
  } catch (error) {
    next(error);
  }
}

function parseStage(value: unknown): StageKey | null {
  const key = String(value || "") as StageKey;
  return STAGE_KEYS.includes(key) ? key : null;
}

/**
 * POST /api/workflow-capture/dev/run/:stage
 * Starts one AI stage in the background and returns immediately — episodes and
 * grading take tens of seconds, and a page that hangs on them cannot also show
 * the live event stream.
 */
export async function runLabStage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (devOnly(res)) return;
    const stage = parseStage(req.params.stage);
    if (!stage) {
      res.status(400).json({ error: "unknown_stage", allowed: STAGE_KEYS });
      return;
    }
    const sessionId = String(req.body?.sessionId || "");
    if (!sessionId) {
      res.status(400).json({ error: "sessionId_required" });
      return;
    }
    const criteria = Array.isArray(req.body?.criteria)
      ? req.body.criteria.map((c: unknown) => String(c))
      : undefined;

    const state = startStage(sessionId, stage, {
      criteria,
      question: typeof req.body?.question === "string" ? req.body.question : undefined,
      replaceExisting: req.body?.replaceExisting !== false,
    });
    const { result, ...status } = state;
    res.status(202).json({ stage, ...status });
  } catch (error) {
    next(error);
  }
}

/** GET /api/workflow-capture/dev/stage/:stage?sessionId= — the cached payload. */
export async function getLabStage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (devOnly(res)) return;
    const stage = parseStage(req.params.stage);
    if (!stage) {
      res.status(400).json({ error: "unknown_stage", allowed: STAGE_KEYS });
      return;
    }
    const sessionId = String(req.query.sessionId || "");
    if (!sessionId) {
      res.status(400).json({ error: "sessionId_required" });
      return;
    }
    res.status(200).json({ stage, ...getStageResult(sessionId, stage) });
  } catch (error) {
    next(error);
  }
}
