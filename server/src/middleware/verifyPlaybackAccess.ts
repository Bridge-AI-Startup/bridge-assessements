import type { RequestHandler } from "express";

import { verifyAuthToken } from "../validators/auth.js";
import { verifyPlaybackToken } from "../utils/playbackToken.js";

/**
 * Allows playback-video access via Firebase Bearer token OR ?pt= playback token
 * (required for native <video> elements that cannot send Authorization headers).
 */
export const verifyPlaybackAccess: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return verifyAuthToken(req, res, next);
  }

  const pt =
    typeof req.query.pt === "string" ? req.query.pt.trim() : undefined;
  const { sessionId } = req.params;

  if (!pt || !sessionId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const payload = verifyPlaybackToken(pt, sessionId);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired playback token" });
  }

  (req as any).playbackUserId = payload.userId;
  return next();
};
