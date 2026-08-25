import express from "express";
import * as PlayController from "../controllers/shorts/index.js";
import { optionalAuthToken, verifyAuthToken } from "../validators/auth.js";
import { requirePlayAdmin } from "../middleware/requireShortsAdmin.js";
import {
  accountLinkValidation,
  createChallengeValidation,
  createSessionValidation,
  publicListChallengesValidation,
  getSessionValidation,
  listChallengesValidation,
  listSessionFilesValidation,
  listSubmissionsValidation,
  pauseResumeSessionValidation,
  postClaudeMessageValidation,
  getClaudeTurnValidation,
  publicGetSubmissionValidation,
  publicListSubmissionsValidation,
  previewSubmissionFileValidation,
  deleteOwnSubmissionValidation,
  renameOwnSubmissionValidation,
  readSessionFileValidation,
  sessionPreviewFileValidation,
  slugParamValidation,
  starSubmissionValidation,
  listStarsValidation,
  submissionIdParamValidation,
  submitSessionValidation,
  updateChallengeValidation,
  castVoteValidation,
  voteNextValidation,
  leaderboardValidation,
  writeSessionFileValidation,
} from "../validators/shortsValidation.js";

const router = express.Router();

// GET /health is mounted always-on in server.ts (deploy smoke tests).
router.get("/round", PlayController.getCurrentRound);
// Legacy alias for older deployed clients.
router.get("/today", PlayController.getCurrentRound);
router.get("/period", PlayController.getPeriod);
router.get("/models", PlayController.listModels);
router.get(
  "/challenges",
  publicListChallengesValidation,
  PlayController.listPublicChallenges,
);
// OG share card (HTML) — target of the Shorts Vercel bot-UA rewrite (?id=…).
router.get("/share", PlayController.getSharePage);

// Account routes: Firebase-authenticated consumers (no admin allowlist).
router.post(
  "/account/link",
  verifyAuthToken,
  accountLinkValidation,
  PlayController.postAccountLink,
);
router.get(
  "/account/submissions",
  verifyAuthToken,
  PlayController.getAccountSubmissionsHandler,
);
// Immutable submission previews (before other parameterized routes).
router.get(
  "/preview/:id/:revision",
  previewSubmissionFileValidation,
  PlayController.getSubmissionPreviewFile,
);
router.get(
  "/preview/:id/:revision/*",
  previewSubmissionFileValidation,
  PlayController.getSubmissionPreviewFile,
);
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
  "/session/:id/cancel",
  pauseResumeSessionValidation,
  PlayController.cancelSession,
);
router.post(
  "/session/:id/restart",
  pauseResumeSessionValidation,
  PlayController.restartSession,
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
// Serverless make mode: serve the live session's generated file(s) for the iframe.
router.get(
  "/session/:id/preview",
  sessionPreviewFileValidation,
  PlayController.getSessionPreviewFile,
);
router.get(
  "/session/:id/preview/*",
  sessionPreviewFileValidation,
  PlayController.getSessionPreviewFile,
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
  "/session/:id/turn/:turnId",
  getClaudeTurnValidation,
  PlayController.getClaudeTurn,
);
// Anthropic-compatible Messages API for Claude Code in the sandbox
router.post(
  "/session/:id/llm/v1/messages",
  PlayController.proxySessionMessages,
);
// Optional auth: a signed-in builder stamps the submission with their account
// (and links this browser id); guests submit unauthenticated exactly as before.
router.post(
  "/submit",
  optionalAuthToken,
  submitSessionValidation,
  PlayController.submit,
);
router.get(
  "/submissions",
  publicListSubmissionsValidation,
  PlayController.listPublicSubmissions,
);
// Private bookmarks ("save this build"): star/unstar + the caller's saved list.
router.post(
  "/submissions/:id/star",
  optionalAuthToken,
  starSubmissionValidation,
  PlayController.starSubmissionHandler,
);
router.delete(
  "/submissions/:id/star",
  optionalAuthToken,
  starSubmissionValidation,
  PlayController.unstarSubmissionHandler,
);
router.get(
  "/stars",
  optionalAuthToken,
  listStarsValidation,
  PlayController.listStarsHandler,
);
// Grab a build's files: single self-contained file as-is, multi-file as a zip.
router.get(
  "/submissions/:id/download",
  submissionIdParamValidation,
  PlayController.downloadSubmission,
);
router.get(
  "/submissions/:id",
  optionalAuthToken,
  publicGetSubmissionValidation,
  PlayController.getPublicSubmission,
);
router.delete(
  "/submissions/:id",
  optionalAuthToken,
  deleteOwnSubmissionValidation,
  PlayController.deleteOwnSubmissionHandler,
);
router.patch(
  "/submissions/:id",
  optionalAuthToken,
  renameOwnSubmissionValidation,
  PlayController.renameOwnSubmissionHandler,
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
adminRouter.post(
  "/challenges/:slug/activate",
  slugParamValidation,
  PlayController.adminActivateChallenge,
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
adminRouter.delete(
  "/submissions/:id",
  submissionIdParamValidation,
  PlayController.adminDeleteSubmission,
);
router.use("/admin", adminRouter);

export default router;
