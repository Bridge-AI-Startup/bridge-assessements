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
  publicGetSubmissionValidation,
  publicListSubmissionsValidation,
  previewSubmissionFileValidation,
  readSessionFileValidation,
  sessionPreviewFileValidation,
  slugParamValidation,
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
router.get("/today", PlayController.getToday);
router.get("/period", PlayController.getPeriod);
router.get("/models", PlayController.listModels);
router.get(
  "/challenges",
  publicListChallengesValidation,
  PlayController.listPublicChallenges,
);

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
  "/session/:id/resume",
  pauseResumeSessionValidation,
  PlayController.resumeSession,
);
// Opening the submit dialog stops the submit clock (not the build clock).
router.post(
  "/session/:id/submit-hold",
  pauseResumeSessionValidation,
  PlayController.holdSessionSubmit,
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
