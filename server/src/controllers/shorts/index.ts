import type { RequestHandler } from "express";
import { validationResult } from "express-validator";
import validationErrorParser from "../../utils/validationErrorParser.js";
import {
  createChallenge,
  getChallengeBySlug,
  getTodayChallenge,
  listChallenges,
  listPastChallenges,
  updateChallenge,
  type ChallengeStatus,
} from "../../services/shorts/challenges.js";
import {
  getAccountSubmissions,
  linkAnonymousId,
} from "../../services/shorts/account.js";
import { getChallengePeriodInfo } from "../../services/shorts/challengePeriod.js";
import {
  createOrResumeSession,
  getSession as getPlaySession,
  getSessionWorkspaceRevision,
  isSessionQueueError,
  holdPlayBuildSessionSubmit,
  pausePlayBuildSession,
  resumePlayBuildSession,
} from "../../services/shorts/sessions.js";
import {
  deleteSubmission,
  getSubmissionById,
  listSubmissions,
  submitSession,
} from "../../services/shorts/submissions.js";
import {
  isStarterOnlyError,
  STARTER_ONLY_CODE,
} from "../../services/shorts/starterDetection.js";
import {
  castVote,
  getLeaderboard as getPlayLeaderboard,
  getNextVotePair,
  getPublicSubmissionById,
  listPublicSubmissions as listPlayPublicSubmissions,
} from "../../services/shorts/voting.js";
import {
  getPlaySessionPreviewFile,
  getPlaySubmissionPreviewFile,
} from "../../services/shorts/preview.js";
import {
  getSessionUsage as getPlaySessionUsage,
  handlePlayMessagesProxy,
  runClaudePrintPrompt,
} from "../../services/shorts/llmProxy.js";
import {
  getSessionMakeMode,
  runServerlessMakeTurn,
} from "../../services/shorts/serverlessMake.js";
import {
  listSessionProjectFiles,
  readSessionProjectFile,
  writeSessionProjectFile,
} from "../../services/shorts/workspaceFiles.js";
import { listPlayModelsPublic } from "../../services/shorts/models.js";

export const health: RequestHandler = (_req, res) => {
  res.status(200).json({ ok: true, product: "shorts" });
};

export const getPeriod: RequestHandler = (_req, res) => {
  res.status(200).json(getChallengePeriodInfo());
};

export const getToday: RequestHandler = async (_req, res, next) => {
  try {
    const challenge = await getTodayChallenge();
    if (!challenge) {
      res.status(404).json({ error: "no_challenge_today" });
      return;
    }
    res.status(200).json(challenge);
  } catch (error) {
    next(error);
  }
};

export const listModels: RequestHandler = (_req, res) => {
  res.status(200).json(listPlayModelsPublic());
};

export const adminListChallenges: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const limit = req.query.limit
      ? parseInt(String(req.query.limit), 10)
      : undefined;
    const fromDate = req.query.from ? String(req.query.from) : undefined;
    const toDate = req.query.to ? String(req.query.to) : undefined;
    const status = req.query.status
      ? (String(req.query.status) as ChallengeStatus)
      : undefined;

    const challenges = await listChallenges({
      limit,
      fromDate,
      toDate,
      status,
    });

    res.status(200).json({ challenges });
  } catch (error) {
    next(error);
  }
};

export const adminGetChallenge: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const challenge = await getChallengeBySlug(req.params.slug);
    if (!challenge) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.status(200).json(challenge);
  } catch (error) {
    next(error);
  }
};

export const adminCreateChallenge: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const challenge = await createChallenge(req.body);
    res.status(201).json(challenge);
  } catch (error) {
    next(error);
  }
};

export const adminUpdateChallenge: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const challenge = await updateChallenge(req.params.slug, req.body);
    res.status(200).json(challenge);
  } catch (error) {
    next(error);
  }
};

export const createSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const session = await createOrResumeSession({
      anonymousId: String(req.body.anonymousId),
    });
    res.status(200).json(session);
  } catch (error) {
    if (isSessionQueueError(error)) {
      res.status(503).json({
        error: "session_queue",
        ...error.toJSON(),
      });
      return;
    }
    next(error);
  }
};

export const getSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const session = await getPlaySession(
      String(req.params.id),
      String(req.query.anonymousId),
    );
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
};

/** Opening the submit dialog stops the submit clock. See holdPlayBuildSessionSubmit. */
export const holdSessionSubmit: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await holdPlayBuildSessionSubmit(
      String(req.params.id),
      String(req.body.anonymousId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const pauseSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await pausePlayBuildSession(
      String(req.params.id),
      String(req.body.anonymousId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const resumeSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const session = await resumePlayBuildSession(
      String(req.params.id),
      String(req.body.anonymousId),
    );
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
};

export const getWorkspaceRevision: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await getSessionWorkspaceRevision(
      String(req.params.id),
      String(req.query.anonymousId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

function resolveFilePathFromReq(req: {
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
  params: Record<string, string>;
}): string {
  const fromQuery =
    typeof req.query.path === "string" ? req.query.path : undefined;
  const fromBody =
    req.body && typeof req.body.path === "string" ? req.body.path : undefined;
  // Express splat: /files/* → params[0] or params.path
  const splat =
    typeof req.params[0] === "string"
      ? req.params[0]
      : typeof req.params.path === "string"
        ? req.params.path
        : undefined;
  return String(fromQuery || fromBody || splat || "").trim();
}

export const listSessionFiles: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await listSessionProjectFiles(
      String(req.params.id),
      String(req.query.anonymousId),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const readSessionFile: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const path = resolveFilePathFromReq(req);
    if (!path) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const result = await readSessionProjectFile(
      String(req.params.id),
      String(req.query.anonymousId),
      path,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const writeSessionFile: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const path = resolveFilePathFromReq(req);
    if (!path) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const result = await writeSessionProjectFile(
      String(req.params.id),
      String(req.body.anonymousId),
      path,
      String(req.body.content ?? ""),
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const proxySessionMessages: RequestHandler = async (req, res, next) => {
  try {
    await handlePlayMessagesProxy(req, res);
  } catch (error) {
    next(error);
  }
};

export const getSessionUsage: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const usage = await getPlaySessionUsage(
      String(req.params.id),
      String(req.query.anonymousId),
    );
    res.status(200).json(usage);
  } catch (error) {
    next(error);
  }
};

export const postClaudeMessage: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const prompt = String(req.body.prompt ?? req.body.message ?? "").trim();
    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    const turnInput = {
      sessionId: String(req.params.id),
      anonymousId: String(req.body.anonymousId),
      prompt,
      model:
        typeof req.body.model === "string" ? req.body.model : undefined,
      effort:
        typeof req.body.effort === "string" ? req.body.effort : undefined,
    };
    // Per-session make mode picks the path: serverless (direct Anthropic call)
    // vs E2B (claude -p in the sandbox). E2B path is unchanged.
    const makeMode = await getSessionMakeMode(turnInput.sessionId);
    const result =
      makeMode === "serverless"
        ? await runServerlessMakeTurn(turnInput)
        : await runClaudePrintPrompt(turnInput);
    let usage = null;
    try {
      usage = await getPlaySessionUsage(
        String(req.params.id),
        String(req.body.anonymousId),
      );
    } catch {
      // ignore
    }
    res.status(200).json({
      output: result.output,
      exitCode: result.exitCode,
      model: result.model,
      effort: result.effort,
      // Serverless turns report whether the reply rebuilt the app or was just
      // chat; the E2B path leaves this null and the client diffs the workspace.
      workspaceChanged:
        "workspaceChanged" in result ? result.workspaceChanged : null,
      usage,
    });
  } catch (error) {
    next(error);
  }
};

export const submit: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await submitSession({
      sessionId: String(req.body.sessionId),
      anonymousId: String(req.body.anonymousId),
      displayName: String(req.body.displayName),
      // optionalAuthToken sets `uid` only for a valid Firebase token; guests
      // submit exactly as before.
      firebaseUid: req.body.uid ? String(req.body.uid) : null,
    });
    res.status(200).json(result);
  } catch (error) {
    if (isStarterOnlyError(error)) {
      res.status(400).json({
        code: STARTER_ONLY_CODE,
        error: error.message,
      });
      return;
    }
    next(error);
  }
};

export const adminListSubmissions: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const limit = req.query.limit
      ? parseInt(String(req.query.limit), 10)
      : undefined;
    const challengeDate = req.query.challengeDate
      ? String(req.query.challengeDate)
      : undefined;
    const submissions = await listSubmissions({ limit, challengeDate });
    res.status(200).json({ submissions });
  } catch (error) {
    next(error);
  }
};

export const adminGetSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const submission = await getSubmissionById(String(req.params.id));
    res.status(200).json(submission);
  } catch (error) {
    next(error);
  }
};

export const adminDeleteSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await deleteSubmission(String(req.params.id));
    res.status(200).json({ deleted: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const listPublicSubmissions: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const challengeDate = req.query.challengeDate
      ? String(req.query.challengeDate)
      : undefined;
    const limit = req.query.limit
      ? parseInt(String(req.query.limit), 10)
      : undefined;
    const anonymousId = req.query.anonymousId
      ? String(req.query.anonymousId)
      : undefined;
    const result = await listPlayPublicSubmissions({
      challengeDate,
      limit,
      anonymousId,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getPublicSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const anonymousId = req.query.anonymousId
      ? String(req.query.anonymousId)
      : undefined;
    const includeFiles = parseIncludeFilesFlag(req.query.includeFiles, true);
    const submission = await getPublicSubmissionById(
      String(req.params.id),
      anonymousId,
      { includeFiles },
    );
    res.status(200).json(submission);
  } catch (error) {
    next(error);
  }
};

function parseIncludeFilesFlag(
  value: unknown,
  defaultValue = true,
): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return defaultValue;
}

function buildPlayPreviewFrameAncestors(): string {
  const candidates = [
    process.env.SHORTS_FRONTEND_URL,
    process.env.PLAY_FRONTEND_URL,
    "https://shorts.bridge-jobs.com",
    "https://play.bridge-jobs.com",
    "https://bridge-play.vercel.app",
    "http://localhost:5174",
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin);
      }
    } catch {
      // Ignore invalid configured URLs to prevent header injection.
    }
  }
  return `frame-ancestors ${[...origins].join(" ")}`;
}

export const getSubmissionPreviewFile: RequestHandler = async (
  req,
  res,
  next,
) => {
  // Default to no-store so validation/404 paths never get cached.
  res.setHeader("Cache-Control", "no-store");
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const splat =
      typeof req.params[0] === "string" ? req.params[0] : undefined;
    const file = await getPlaySubmissionPreviewFile({
      submissionId: String(req.params.id),
      revision: String(req.params.revision),
      path: splat,
    });

    // Prefer Express MIME lookup from the stored path extension.
    res.type(file.path);
    const contentType = String(res.getHeader("Content-Type") || "");
    if (
      !contentType ||
      contentType.includes("application/octet-stream")
    ) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }

    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader(
      "Content-Security-Policy",
      buildPlayPreviewFrameAncestors(),
    );
    // Do not set X-Frame-Options: SAMEORIGIN — blocks cross-origin Play iframes.
    res.status(200).send(file.content);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    next(error);
  }
};

export const getSessionPreviewFile: RequestHandler = async (req, res, next) => {
  // Live session preview mutates every turn — never cache.
  res.setHeader("Cache-Control", "no-store");
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const splat =
      typeof req.params[0] === "string" ? req.params[0] : undefined;
    const file = await getPlaySessionPreviewFile({
      sessionId: String(req.params.id),
      anonymousId: String(req.query.anonymousId),
      path: splat,
    });

    res.type(file.path);
    const contentType = String(res.getHeader("Content-Type") || "");
    if (!contentType || contentType.includes("application/octet-stream")) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", buildPlayPreviewFrameAncestors());
    res.status(200).send(file.content);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    next(error);
  }
};

export const getVoteNext: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await getNextVotePair({
      anonymousId: String(req.query.anonymousId),
      challengeDate: req.query.challengeDate
        ? String(req.query.challengeDate)
        : undefined,
      preferId: req.query.preferId ? String(req.query.preferId) : undefined,
      includeFiles: parseIncludeFilesFlag(req.query.includeFiles, true),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postVote: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await castVote({
      anonymousId: String(req.body.anonymousId),
      challengeDate: req.body.challengeDate
        ? String(req.body.challengeDate)
        : undefined,
      winnerId: String(req.body.winnerId),
      loserId: String(req.body.loserId),
      includeFiles: parseIncludeFilesFlag(req.body.includeFiles, true),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getLeaderboard: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await getPlayLeaderboard({
      challengeDate: req.query.challengeDate
        ? String(req.query.challengeDate)
        : undefined,
      limit: req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : undefined,
      anonymousId: req.query.anonymousId
        ? String(req.query.anonymousId)
        : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const listPublicChallenges: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await listPastChallenges({
      limit: req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const postAccountLink: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    // verifyAuthToken puts the verified Firebase uid on the body.
    const result = await linkAnonymousId({
      firebaseUid: String(req.body.uid || ""),
      anonymousId: String(req.body.anonymousId || ""),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getAccountSubmissionsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const result = await getAccountSubmissions(String(req.body.uid || ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
