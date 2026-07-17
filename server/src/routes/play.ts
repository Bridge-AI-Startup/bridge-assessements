import express from "express";
import * as PlayController from "../controllers/play/index.js";
import { verifyAuthToken } from "../validators/auth.js";
import { requirePlayAdmin } from "../middleware/requirePlayAdmin.js";
import {
  createChallengeValidation,
  createSessionValidation,
  getSessionValidation,
  listChallengesValidation,
  listSessionFilesValidation,
  listSubmissionsValidation,
  listTerminalsValidation,
  openTerminalValidation,
  pauseResumeSessionValidation,
  postClaudeMessageValidation,
  publicGetSubmissionValidation,
  publicListSubmissionsValidation,
  readSessionFileValidation,
  slugParamValidation,
  submissionIdParamValidation,
  submitSessionValidation,
  terminalInputValidation,
  terminalResizeValidation,
  terminalStreamValidation,
  updateChallengeValidation,
  castVoteValidation,
  voteNextValidation,
  leaderboardValidation,
  writeSessionFileValidation,
} from "../validators/playValidation.js";

const router = express.Router();

// GET /health is mounted always-on in server.ts (deploy smoke tests).
router.get("/today", PlayController.getToday);
router.get("/period", PlayController.getPeriod);
router.get("/models", PlayController.listModels);
router.post(
  "/session",
  createSessionValidation,
  PlayController.createSession,
);
router.get(
  "/session/:id",
  getSessionValidation,
  PlayController.getSession,
);
router.post(
  "/session/:id/pause",
  pauseResumeSessionValidation,
  PlayController.pauseSession,
);
router.post(
  "/session/:id/resume",
  pauseResumeSessionValidation,
  PlayController.resumeSession,
);
router.get(
  "/session/:id/workspace-revision",
  getSessionValidation,
  PlayController.getWorkspaceRevision,
);
router.get(
  "/session/:id/files",
  listSessionFilesValidation,
  PlayController.listSessionFiles,
);
// Query form: ?path=relative/file (preferred by Play client)
router.get(
  "/session/:id/file",
  readSessionFileValidation,
  PlayController.readSessionFile,
);
router.put(
  "/session/:id/file",
  writeSessionFileValidation,
  PlayController.writeSessionFile,
);
// Splat form: /files/<relpath>
router.get(
  "/session/:id/files/*",
  readSessionFileValidation,
  PlayController.readSessionFile,
);
router.put(
  "/session/:id/files/*",
  writeSessionFileValidation,
  PlayController.writeSessionFile,
);
router.get(
  "/session/:id/usage",
  getSessionValidation,
  PlayController.getSessionUsage,
);
router.post(
  "/session/:id/claude/message",
  postClaudeMessageValidation,
  PlayController.postClaudeMessage,
);
router.get(
  "/session/:id/terminals",
  listTerminalsValidation,
  PlayController.listTerminals,
);
router.post(
  "/session/:id/terminal",
  openTerminalValidation,
  PlayController.openTerminal,
);
router.get(
  "/session/:id/terminal/stream",
  terminalStreamValidation,
  PlayController.streamTerminal,
);
router.post(
  "/session/:id/terminal/input",
  terminalInputValidation,
  PlayController.terminalInput,
);
router.post(
  "/session/:id/terminal/resize",
  terminalResizeValidation,
  PlayController.terminalResize,
);
// Anthropic-compatible Messages API for Claude Code in the sandbox
router.post(
  "/session/:id/llm/v1/messages",
  PlayController.proxySessionMessages,
);
// Legacy stub path (kept for discovery; prefer /llm/v1/messages)
router.post("/session/:id/llm", PlayController.sessionLlm);
router.post("/submit", submitSessionValidation, PlayController.submit);
router.get(
  "/submissions",
  publicListSubmissionsValidation,
  PlayController.listPublicSubmissions,
);
router.get(
  "/submissions/:id",
  publicGetSubmissionValidation,
  PlayController.getPublicSubmission,
);
router.get("/vote/next", voteNextValidation, PlayController.getVoteNext);
router.post("/vote", castVoteValidation, PlayController.postVote);
router.get(
  "/leaderboard",
  leaderboardValidation,
  PlayController.getLeaderboard,
);

const adminRouter = express.Router();
adminRouter.use(verifyAuthToken, requirePlayAdmin);
adminRouter.get(
  "/challenges",
  listChallengesValidation,
  PlayController.adminListChallenges,
);
adminRouter.get(
  "/challenges/:slug",
  slugParamValidation,
  PlayController.adminGetChallenge,
);
adminRouter.post(
  "/challenges",
  createChallengeValidation,
  PlayController.adminCreateChallenge,
);
adminRouter.patch(
  "/challenges/:slug",
  updateChallengeValidation,
  PlayController.adminUpdateChallenge,
);
adminRouter.get(
  "/submissions",
  listSubmissionsValidation,
  PlayController.adminListSubmissions,
);
adminRouter.get(
  "/submissions/:id",
  submissionIdParamValidation,
  PlayController.adminGetSubmission,
);
router.use("/admin", adminRouter);

export default router;
