import express from "express";
import { Request, Response, NextFunction } from "express";
import * as AgentToolsController from "../controllers/agentTools.js";

const router = express.Router();

/**
 * Middleware to verify agent tool authorization
 * For MVP, accepts X-Agent-Secret header that must match AGENT_SECRET env var
 */
const verifyAgentAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const agentSecret = process.env.AGENT_SECRET;

  // If no secret is configured, allow access (for development/testing)
  // In production, this should always be set
  if (!agentSecret) {
    console.warn(
      "⚠️ [agentTools] AGENT_SECRET not configured. Allowing access without auth."
    );
    return next();
  }

  const providedSecret = req.headers["x-agent-secret"];

  if (!providedSecret) {
    return res.status(401).json({
      error: "Authorization required. Missing X-Agent-Secret header.",
    });
  }

  if (providedSecret !== agentSecret) {
    return res.status(403).json({
      error: "Invalid authorization. X-Agent-Secret header is incorrect.",
    });
  }

  next();
};

// Apply auth middleware to all agent tool routes
router.use(verifyAgentAuth);

// Get context endpoint
router.post("/get-context", AgentToolsController.getContext);

export default router;
