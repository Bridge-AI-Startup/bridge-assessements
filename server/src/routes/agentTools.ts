import express from "express";
import { Request, Response, NextFunction } from "express";
import * as AgentToolsController from "../controllers/agentTools.js";
import {
  agentSecretConfigured,
  agentSecretMatches,
} from "../utils/agentSecret.js";

const router = express.Router();

/**
 * Middleware to verify agent tool authorization via the X-Agent-Secret header.
 * Fail-closed: a deployment missing AGENT_SECRET refuses requests rather than
 * exposing candidate context unauthenticated.
 */
const verifyAgentAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!agentSecretConfigured()) {
    console.error(
      "[agentTools] AGENT_SECRET is not set — refusing agent tool request. Set it in config.env."
    );
    res.status(503).json({ error: "agent_tools_unconfigured" });
    return;
  }

  const providedSecret = req.headers["x-agent-secret"];

  if (!providedSecret) {
    res.status(401).json({
      error: "Authorization required. Missing X-Agent-Secret header.",
    });
    return;
  }

  if (!agentSecretMatches(providedSecret)) {
    res.status(403).json({
      error: "Invalid authorization. X-Agent-Secret header is incorrect.",
    });
    return;
  }

  next();
};

// Apply auth middleware to all agent tool routes
router.use(verifyAgentAuth);

// Context center: assessment + conversation + timeline + code in one call
router.post("/context", AgentToolsController.getContextCenter);

export default router;
