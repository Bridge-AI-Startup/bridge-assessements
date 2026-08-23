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
import { renderSubmissionSharePage } from "../../services/shorts/sharePage.js";
import {
  cancelPlayBuildSession,
  createOrResumeSession,
  getSession as getPlaySession,
  getSessionWorkspaceRevision,
  isSessionQueueError,
  pausePlayBuildSession,
  resumePlayBuildSession,
} from "../../services/shorts/sessions.js";
import {
  deleteOwnSubmission,
  deleteSubmission,
  getSubmissionById,
  listSubmissions,
  renameOwnSubmission,
  submitSession,
  isSubmissionLimitError,
  SUBMISSION_LIMIT_CODE,
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
} from "../../services/shorts/llmProxy.js";
import {
  getSessionTurn,
  startSessionTurn,
} from "../../services/shorts/turns.js";
import {
  listSessionProjectFiles,
  readSessionProjectFile,
  writeSessionProjectFile,
} from "../../services/shorts/workspaceFiles.js";
import { listPlayModelsPublic } from "../../services/shorts/models.js";
import archiver from "archiver";
import {
  getPlaySubmissionDownloadBundle,
  renderPlayDownloadAbout,
  resolvePlayDownloadFileName,
} from "../../services/shorts/download.js";
import { listStarred, setStarred } from "../../services/shorts/stars.js";

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

/**
 * OpenGraph share card for a submission. Social crawlers land here via the
 * Shorts Vercel bot-UA rewrite of `/Submission`; humans who follow the API URL
 * directly are meta-refreshed to the client page. Serves HTML, not JSON.
 */
export const getSharePage: RequestHandler = async (req, res, next) => {
  try {
    const html = await renderSubmissionSharePage(
      typeof req.query.id === "string" ? req.query.id : undefined,
    );
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      // Crawlers re-fetch aggressively; a short shared cache keeps a viral
      // link from hammering Mongo while staying fresh enough for edits.
      .set("Cache-Control", "public, max-age=300")
      .send(html);
  } catch (error) {
    next(error);
  }
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

export const cancelSession: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await cancelPlayBuildSession(
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
    const started = await startSessionTurn({
      sessionId: String(req.params.id),
      anonymousId: String(req.body.anonymousId),
      prompt,
      model:
        typeof req.body.model === "string" ? req.body.model : undefined,
      effort:
        typeof req.body.effort === "string" ? req.body.effort : undefined,
    });
    res.status(202).json(started);
  } catch (error) {
    next(error);
  }
};

export const getClaudeTurn: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const turn = await getSessionTurn(
      String(req.params.id),
      String(req.params.turnId),
      String(req.query.anonymousId),
    );
    res.status(200).json(turn);
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
    if (isSubmissionLimitError(error)) {
      res.status(409).json({
        code: SUBMISSION_LIMIT_CODE,
        error: error.message,
        count: error.count,
        max: error.max,
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

export const deleteOwnSubmissionHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const uid =
      (req as { user?: { uid?: string } }).user?.uid ||
      (req.body && typeof req.body.uid === "string" ? req.body.uid : "");
    const result = await deleteOwnSubmission(String(req.params.id), {
      anonymousId:
        req.body && typeof req.body.anonymousId === "string"
          ? req.body.anonymousId
          : undefined,
      firebaseUid: uid || null,
    });
    res.status(200).json({ deleted: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const renameOwnSubmissionHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const uid =
      (req as { user?: { uid?: string } }).user?.uid ||
      (req.body && typeof req.body.uid === "string" ? req.body.uid : "");
    const result = await renameOwnSubmission(String(req.params.id), {
      anonymousId:
        req.body && typeof req.body.anonymousId === "string"
          ? req.body.anonymousId
          : undefined,
      firebaseUid: uid || null,
      displayName: String(req.body.displayName),
    });
    res.status(200).json({ renamed: true, ...result });
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
    const firebaseUid =
      (req as { user?: { uid?: string } }).user?.uid ||
      (req.body && typeof req.body.uid === "string" ? req.body.uid : undefined);
    const submission = await getPublicSubmissionById(
      String(req.params.id),
      anonymousId,
      { includeFiles, firebaseUid },
    );
    res.status(200).json(submission);
  } catch (error) {
    next(error);
  }
};

/** Shared shape for the star toggle handlers. */
function starRequestInput(req: Parameters<RequestHandler>[0]) {
  return {
    submissionId: String(req.params.id),
    anonymousId:
      req.body && typeof req.body.anonymousId === "string"
        ? req.body.anonymousId
        : "",
    firebaseUid: (req as { user?: { uid?: string } }).user?.uid || null,
  };
}

export const starSubmissionHandler: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await setStarred({ ...starRequestInput(req), starred: true });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const unstarSubmissionHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await setStarred({
      ...starRequestInput(req),
      starred: false,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const listStarsHandler: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const result = await listStarred({
      anonymousId: String(req.query.anonymousId || ""),
      firebaseUid: (req as { user?: { uid?: string } }).user?.uid || null,
      idsOnly: req.query.idsOnly === "true" || req.query.idsOnly === "1",
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Download a build's files. A single stored file (the common serverless
 * self-contained index.html) downloads as itself so it opens straight in a
 * browser; multi-file builds stream as a zip with an ABOUT.txt pointing back
 * at the submission page. Public, same as the gallery preview.
 */
export const downloadSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const bundle = await getPlaySubmissionDownloadBundle(String(req.params.id));
    const { kind, fileName } = resolvePlayDownloadFileName(
      bundle.baseName,
      bundle.files,
    );

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Let the browser fetch()-side read the chosen filename cross-origin.
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.attachment(fileName);

    if (kind === "file") {
      res.type(fileName);
      const contentType = String(res.getHeader("Content-Type") || "");
      if (!contentType || contentType.includes("application/octet-stream")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.status(200).send(bundle.files[0].content);
      return;
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      // Headers are likely already flushed — kill the stream so the client
      // sees a failed download rather than a truncated "valid" zip.
      res.destroy(err);
    });
    archive.pipe(res);
    archive.append(renderPlayDownloadAbout(bundle), {
      name: `${bundle.baseName}/ABOUT.txt`,
    });
    for (const file of bundle.files) {
      archive.append(file.content, { name: `${bundle.baseName}/${file.path}` });
    }
    await archive.finalize();
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
