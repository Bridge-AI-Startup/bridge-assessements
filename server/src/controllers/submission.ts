import { RequestHandler } from "express";
import { validationResult } from "express-validator";
import { createHash, randomUUID } from "crypto";
import path from "path";
import util from "util";
import archiver from "archiver";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import { getShareLinkBaseUrl } from "../utils/shareLink.js";
import { parseGithubRepoUrl, resolvePinnedCommit } from "../utils/github.js";
import {
  downloadAndExtractRepoSnapshot,
  cleanupRepoSnapshot,
} from "../utils/repoSnapshot.js";
import { generateInterviewQuestionsFromRetrieval } from "../services/interviewGeneration.js";
import { indexSubmissionRepo } from "../services/repoIndexing.js";
import { searchCodeChunks } from "../services/repoRetrieval.js";
import RepoIndexModel from "../models/repoIndex.js";
import { deleteNamespace } from "../utils/pinecone.js";
import { PROMPT_INTERVIEW_AGENT } from "../prompts/index.js";
import { logLLMEvent } from "../services/llmProxy/logger.js";
import { executeAllTasks } from "../services/taskRunner/taskRunner.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import { getProctoringTranscriptForSubmission } from "../services/evaluation/proctoringTranscriptAdapter.js";
import { evaluateTranscript } from "../services/evaluation/orchestrator.js";
import { generateTranscript, finalizeTranscriptFromIncremental } from "../ai/transcript/generator.js";
import { jsonlToScreenMoments } from "../services/evaluation/momentGrouper.js";
import { interpretChunked } from "../services/evaluation/interpreterChunked.js";
import { interpretStateful } from "../services/evaluation/interpreterStateful.js";
import { getFrameStorage } from "../services/capture/storage.js";
import {
  gradeSubmissionBehavioral,
  isBehavioralGradingEnabled,
} from "../services/behavioralGrading/index.js";
import { getGradingEvidenceStorage } from "../services/gradingEvidence/storage.js";
import { calculateAndSaveScores } from "../services/scoring.js";
import { getSubmissionCodeStorage } from "../services/submissionCode/storage.js";
import { collectBehavioralArtifactKeys } from "../utils/behavioralEvidenceKeys.js";

const TRANSCRIPT_POLL_INTERVAL_MS = 15000;
const TRANSCRIPT_POLL_MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes
const FINAL_SUBMISSION_GRACE_MINUTES = 5;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b]);
const SUBMISSION_SOURCE_MODE = (
  process.env.SUBMISSION_SOURCE_MODE || "both"
).toLowerCase();

function looksLikeZipArchive(file: Express.Multer.File): boolean {
  if (!file?.buffer || file.buffer.length < 2) return false;
  if (file.buffer.subarray(0, 2).equals(ZIP_SIGNATURE)) return true;
  return file.originalname?.toLowerCase().endsWith(".zip") === true;
}

function isGithubSubmissionEnabled(): boolean {
  return SUBMISSION_SOURCE_MODE === "both" || SUBMISSION_SOURCE_MODE === "github";
}

function isUploadSubmissionEnabled(): boolean {
  return SUBMISSION_SOURCE_MODE === "both" || SUBMISSION_SOURCE_MODE === "upload";
}

function getSubmissionTimingWindow(
  submission: any,
  assessment: any
): {
  elapsedMinutes: number | null;
  isLate: boolean;
  isBeyondGrace: boolean;
} {
  if (!assessment?.timeLimit || !submission?.startedAt) {
    return { elapsedMinutes: null, isLate: false, isBeyondGrace: false };
  }

  const elapsedMinutes =
    (Date.now() - new Date(submission.startedAt).getTime()) / (1000 * 60);
  const isLate = elapsedMinutes > assessment.timeLimit;
  const isBeyondGrace =
    elapsedMinutes > assessment.timeLimit + FINAL_SUBMISSION_GRACE_MINUTES;

  return { elapsedMinutes, isLate, isBeyondGrace };
}

async function setEvaluationFailed(
  submissionId: string,
  message: string
): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      evaluationStatus: "failed",
      evaluationError: message,
    },
  });
}

async function setBehavioralGradingFailed(
  submissionId: string,
  message: string
): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      behavioralGradingStatus: "failed",
      behavioralGradingError: message,
    },
  });
}

function triggerBehavioralGradingInBackground(
  submissionId: string,
  source: "submitSubmissionByToken" | "submitSubmission" | "manual"
): void {
  if (!isBehavioralGradingEnabled()) {
    return;
  }
  SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: {
      behavioralGradingStatus: "pending",
      behavioralGradingError: null,
      behavioralGradingReport: null,
    },
  })
    .then(() => gradeSubmissionBehavioral(submissionId))
    .then((report) =>
      SubmissionModel.findByIdAndUpdate(submissionId, {
        $set: {
          behavioralGradingStatus: "completed",
          behavioralGradingError: null,
          behavioralGradingReport: report,
        },
      })
    )
    .catch((err) => {
      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      console.error(
        `[${source}] Behavioral grading failed for submission ${submissionId}: ${message}`
      );
      console.error(
        `[${source}] Behavioral grading error detail:`,
        util.inspect(err, { depth: 8, breakLength: 120 })
      );
      setBehavioralGradingFailed(
        submissionId,
        message
      ).catch(() => {});
    });
}

/**
 * Background: ensure proctoring session has a transcript (generate if needed), then load it,
 * set on submission, and run screen-recording evaluation. Does not block submit response.
 */
async function ensureProctoringTranscriptAndEvaluate(
  submissionId: string
): Promise<void> {
  const sub = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!sub) return;
  const assessment = sub.assessmentId as any;
  const criteria = assessment?.evaluationCriteria;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    await setEvaluationFailed(
      submissionId,
      "Assessment has no evaluation criteria configured."
    );
    return;
  }

  const session = await ProctoringSessionModel.findOne({
    submissionId: submissionId as any,
  });
  if (!session) {
    console.warn(
      `[ensureProctoringTranscriptAndEvaluate] No proctoring session for submission ${submissionId}; transcript will not be attached. Was proctoring started (consent granted) for this attempt?`
    );
    await setEvaluationFailed(
      submissionId,
      "No screen recording for this submission. The candidate must complete the assessment with proctoring enabled."
    );
    return;
  }

  const status = session.transcript?.status ?? "not_started";

  if (status === "generating") {
    const deadline = Date.now() + TRANSCRIPT_POLL_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, TRANSCRIPT_POLL_INTERVAL_MS));
      const updated = await ProctoringSessionModel.findById(session._id);
      if (!updated) return;
      const s = updated.transcript?.status ?? "not_started";
      if (s === "completed") break;
      if (s === "failed") {
        await setEvaluationFailed(
          submissionId,
          "Screen recording transcript generation failed."
        );
        return;
      }
    }
  }

  if (status === "not_started" || status === "failed") {
    const hasIncrementalData =
      session.transcript?.storageKey && session.transcript?.lastIncrementalAt;
    try {
      if (hasIncrementalData) {
        console.log(
          `[ensureProctoringTranscriptAndEvaluate] Finalizing from incremental for submission ${submissionId}`
        );
        await finalizeTranscriptFromIncremental(session._id.toString());
      } else {
        await generateTranscript(session._id.toString());
      }
    } catch (err) {
      console.error(
        `[ensureProctoringTranscriptAndEvaluate] Transcript generation failed for submission ${submissionId}:`,
        err
      );
      await setEvaluationFailed(
        submissionId,
        "Screen recording transcript could not be generated."
      );
      return;
    }
  }

  const transcript = await getProctoringTranscriptForSubmission(submissionId);
  if (!transcript || transcript.length === 0) {
    await setEvaluationFailed(
      submissionId,
      "No transcript available from the screen recording."
    );
    return;
  }

  const updatedSub = await SubmissionModel.findById(submissionId);
  if (!updatedSub) return;
  (updatedSub as any).screenRecordingTranscript = transcript;
  await updatedSub.save();

  // Activity interpretation: enrich raw transcript with behavioral observations
  try {
    const rawJsonl = await loadRawJsonlForSubmission(submissionId);
    if (rawJsonl) {
      const moments = jsonlToScreenMoments(rawJsonl);
      if (moments.length > 0) {
        const strategy = (process.env.INTERPRETER_STRATEGY || "stateful") as "chunked" | "stateful";
        const enriched = strategy === "chunked"
          ? await interpretChunked(moments)
          : await interpretStateful(moments);
        const subForEnriched = await SubmissionModel.findById(submissionId);
        if (subForEnriched) {
          (subForEnriched as any).enrichedTranscript = enriched;
          await subForEnriched.save();
        }
      }
    }
  } catch (err) {
    console.warn(
      `[ensureProctoringTranscriptAndEvaluate] Activity interpretation failed for ${submissionId}:`,
      err
    );
  }

  try {
    const report = await evaluateTranscript(transcript, criteria, {
      groundings: assessment.evaluationCriteriaGroundings,
    });
    const subAfter = await SubmissionModel.findById(submissionId);
    if (!subAfter) return;
    (subAfter as any).evaluationReport = report;
    (subAfter as any).evaluationStatus = "completed";
    (subAfter as any).evaluationError = null;
    await subAfter.save();
  } catch (err) {
    console.error(
      `[ensureProctoringTranscriptAndEvaluate] Evaluation failed for submission ${submissionId}:`,
      err
    );
    const subAfter = await SubmissionModel.findById(submissionId);
    if (subAfter) {
      (subAfter as any).evaluationStatus = "failed";
      (subAfter as any).evaluationError =
        err instanceof Error ? err.message : "Evaluation failed.";
      await subAfter.save();
    }
  }
}

async function loadRawJsonlForSubmission(submissionId: string): Promise<string | null> {
  try {
    const session = await ProctoringSessionModel.findOne({ submissionId: submissionId as any });
    if (!session?.transcript?.storageKey) return null;
    const storage = getFrameStorage();
    return await storage.getTranscript(session.transcript.storageKey);
  } catch {
    return null;
  }
}

export type UpdateSubmissionRequest = {
  githubLink?: string;
  timeSpent?: number;
};

export type SubmitSubmissionRequest = {
  githubLink: string;
  timeSpent?: number;
};

// Helper function to get user ID from Firebase UID (for employer endpoints)
async function getUserIdFromFirebaseUid(firebaseUid: string): Promise<string> {
  const UserModel = (await import("../models/user.js")).default;
  const user = await UserModel.findOne({ firebaseUid });
  if (!user) {
    throw AuthError.INVALID_AUTH_TOKEN;
  }
  return user._id.toString();
}

/**
 * Start an assessment (update submission from "pending" to "in-progress")
 * Public endpoint - no auth required
 */
export const startAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { token } = req.params;

    const submission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Only allow starting if status is "pending"
    if (submission.status !== "pending") {
      return res.status(400).json({
        error:
          submission.status === "submitted"
            ? "Assessment has already been submitted"
            : "Assessment has already been started",
      });
    }

    // Update submission to "in-progress" and set startedAt
    submission.status = "in-progress";
    submission.startedAt = new Date();

    // Add metadata if available
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get("user-agent");
    if (ipAddress || userAgent) {
      if (!submission.metadata) {
        submission.metadata = {};
      }
      if (ipAddress) {
        submission.metadata.ipAddress = ipAddress;
      }
      if (userAgent) {
        submission.metadata.userAgent = userAgent;
      }
    }

    await submission.save();

    // Calculate time remaining
    const assessment = submission.assessmentId as any;
    let timeRemaining = null;
    if (assessment && assessment.timeLimit) {
      timeRemaining = assessment.timeLimit; // Full time limit at start
    }

    const response: any = submission.toObject();
    response.timeRemaining = timeRemaining;

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a submission by token (public endpoint - for candidate access via URL)
 */
export const getSubmissionByToken: RequestHandler = async (req, res, next) => {
  try {
    const { token } = req.params;

    const submission = await SubmissionModel.findOne({ token }).populate({
      path: "assessmentId",
      select: "title description timeLimit starterFilesGitHubLink starterCodeFiles isSmartInterviewerEnabled",
      populate: {
        path: "userId",
        select: "companyName",
      },
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Calculate time remaining if assessment has started
    let timeRemaining = null;
    if (submission.status === "in-progress" && submission.startedAt) {
      const assessment = submission.assessmentId as any;
      if (assessment && assessment.timeLimit) {
        const elapsedMinutes =
          (Date.now() - new Date(submission.startedAt).getTime()) / (1000 * 60);
        const remaining = Math.max(0, assessment.timeLimit - elapsedMinutes);
        // Keep fractional minutes so the client countdown (uses decimal for seconds) does not jump on reload/sync.
        timeRemaining = Number(remaining.toPrecision(12));
      }
    }

    const response: any = submission.toObject();
    response.timeRemaining = timeRemaining;

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a submission by ID (public endpoint - for candidate to resume)
 */
export const getSubmission: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const submission = await SubmissionModel.findById(id).populate(
      "assessmentId",
      "title description timeLimit"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Calculate time remaining if assessment has started
    let timeRemaining = null;
    if (submission.status === "in-progress" && submission.startedAt) {
      const assessment = submission.assessmentId as any;
      if (assessment && assessment.timeLimit) {
        const elapsedMinutes =
          (Date.now() - new Date(submission.startedAt).getTime()) / (1000 * 60);
        const remaining = Math.max(0, assessment.timeLimit - elapsedMinutes);
        timeRemaining = Number(remaining.toPrecision(12));
      }
    }

    const response: any = submission.toObject();
    response.timeRemaining = timeRemaining;

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a submission (auto-save, public endpoint)
 */
export const updateSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { id } = req.params;
    const { githubLink, timeSpent } = req.body as UpdateSubmissionRequest;

    const submission = await SubmissionModel.findById(id);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Don't allow updates to submitted submissions
    if (submission.status === "submitted") {
      return res
        .status(400)
        .json({ error: "Cannot update a submitted assessment" });
    }

    // Update fields
    const updates: {
      githubLink?: string;
      timeSpent?: number;
      githubRepo?: {
        owner: string;
        repo: string;
        refType: "commit" | "branch";
        ref: string;
        pinnedCommitSha: string;
      };
    } = {};

    if (githubLink !== undefined) {
      updates.githubLink = githubLink;

      // Try to parse and resolve GitHub repository information
      // For auto-save, we're lenient - if it fails, we still save the link
      // The final submission will validate it properly
      if (githubLink && githubLink.trim()) {
        try {
          const parsedRepo = parseGithubRepoUrl(githubLink);
          const resolvedRepo = await resolvePinnedCommit(parsedRepo);
          updates.githubRepo = {
            owner: resolvedRepo.owner,
            repo: resolvedRepo.repo,
            refType: resolvedRepo.refType,
            ref: resolvedRepo.ref,
            pinnedCommitSha: resolvedRepo.pinnedCommitSha,
          };
        } catch (error) {
          // Log error but don't fail the update - allow auto-save to continue
          // Final submission will validate properly
          console.warn(
            `Failed to parse GitHub URL during auto-save: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    if (timeSpent !== undefined) {
      updates.timeSpent = timeSpent;
    }

    const updatedSubmission = await SubmissionModel.findByIdAndUpdate(
      id,
      updates,
      { new: true }
    ).populate("assessmentId", "title description timeLimit");

    res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Final submission by token (public endpoint)
 */
export const submitSubmissionByToken: RequestHandler = async (
  req,
  res,
  next
) => {
  const errors = validationResult(req);
  try {
    if (!isGithubSubmissionEnabled()) {
      return res.status(403).json({
        error: "GitHub URL submissions are currently disabled.",
      });
    }
    validationErrorParser(errors);
    const { token } = req.params;
    const { githubLink } = req.body as SubmitSubmissionRequest;

    const submission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Don't allow resubmission
    if (submission.status === "submitted") {
      return res
        .status(400)
        .json({ error: "Assessment has already been submitted" });
    }

    // Validate time limit server-side
    const assessment = submission.assessmentId as any;
    const timing = getSubmissionTimingWindow(submission, assessment);
    if (timing.elapsedMinutes !== null) {
      submission.timeSpent = Math.floor(timing.elapsedMinutes);
      if (timing.isBeyondGrace) {
        return res.status(400).json({
          error:
            "Submission window has closed. You ran out of time and missed the 5-minute grace period.",
        });
      }
      if (timing.isLate) {
        // Time exceeded - mark as expired but still allow submission within grace window.
        submission.status = "expired";
      }
    }

    // Parse and resolve GitHub repository information
    try {
      const parsedRepo = parseGithubRepoUrl(githubLink);
      const resolvedRepo = await resolvePinnedCommit(parsedRepo);

      // Update submission with GitHub link and resolved repository information
      submission.githubLink = githubLink;
      submission.githubRepo = {
        owner: resolvedRepo.owner,
        repo: resolvedRepo.repo,
        refType: resolvedRepo.refType,
        ref: resolvedRepo.ref,
        pinnedCommitSha: resolvedRepo.pinnedCommitSha,
      };
    } catch (error) {
      // If GitHub parsing/resolution fails, return error to user
      // This includes private repo errors, invalid URLs, etc.
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process GitHub repository URL",
      });
    }

    submission.status =
      submission.status === "expired" ? "expired" : "submitted";
    submission.submittedAt = new Date();

    await submission.save();

    const updatedSubmission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId",
      "title description timeLimit"
    );

    // Background: run screen-recording evaluation only when assessment has evaluation criteria
    const submissionIdStr = submission._id.toString();
    const hasEvaluationCriteria =
      Array.isArray(assessment?.evaluationCriteria) &&
      assessment.evaluationCriteria.length > 0;

    if (hasEvaluationCriteria) {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: { evaluationStatus: "pending", evaluationError: null },
      });
      ensureProctoringTranscriptAndEvaluate(submissionIdStr)
        .then(async () => {
          const sub = await SubmissionModel.findById(submissionIdStr);
          if (!sub) return;
          (sub as any).evaluationStatus = (sub as any).evaluationReport
            ? "completed"
            : "failed";
          await sub.save();
        })
        .catch((err) => {
          console.error(
            `[submitSubmissionByToken] ensureProctoringTranscriptAndEvaluate failed for ${submission._id}:`,
            err
          );
          SubmissionModel.findByIdAndUpdate(submissionIdStr, {
            $set: {
              evaluationStatus: "failed",
              evaluationError:
                err instanceof Error ? err.message : "Evaluation failed.",
            },
          }).catch(() => {});
        });
    } else {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: {
          evaluationStatus: "failed",
          evaluationError: "Assessment has no evaluation criteria configured.",
        },
      });
    }

    // Trigger repository indexing in the background (fire-and-forget)
    // This doesn't block the submission response
    if (
      submission.githubRepo &&
      submission.githubRepo.owner &&
      submission.githubRepo.repo &&
      submission.githubRepo.pinnedCommitSha
    ) {
      indexSubmissionRepo(submission._id.toString()).catch((error) => {
        // Log error but don't fail the submission
        console.error(
          `[submitSubmissionByToken] Failed to index repository for submission ${submission._id}:`,
          error
        );
      });
    }

    // NEW: Trigger task execution after submission (background); save results so workflow scoring can run
    if (submission.llmWorkflow?.trace?.events?.length > 0) {
      executeAllTasks(submission._id.toString())
        .then(async (results) => {
          const sub = await SubmissionModel.findById(submission._id);
          if (!sub) return;
          if (!sub.llmWorkflow) {
            sub.llmWorkflow = {
              trace: {
                sessionId: "",
                events: [],
                totalTokens: 0,
                totalCost: 0,
                totalTime: 0,
                totalCalls: 0,
              },
              taskResults: [],
              scores: {},
              evaluation: { harnessVersion: "1.0.0", tasksCompleted: 0, tasksTotal: 0 },
            };
          }
          sub.llmWorkflow.taskResults = results;
          sub.llmWorkflow.evaluation = sub.llmWorkflow.evaluation ?? {
            harnessVersion: "1.0.0",
            tasksCompleted: 0,
            tasksTotal: 0,
          };
          sub.llmWorkflow.evaluation.tasksCompleted = results.filter(
            (r: { status: string }) => r.status === "passed"
          ).length;
          sub.llmWorkflow.evaluation.tasksTotal = results.length;
          await sub.save();
        })
        .catch((error) => {
          console.error(
            `[submitSubmissionByToken] Failed to execute tasks for submission ${submission._id}:`,
            error
          );
        });
    }

    // Trigger behavioral grading after submission (public repos only in v1)
    if (
      submission.githubRepo &&
      submission.githubRepo.owner &&
      submission.githubRepo.repo &&
      submission.githubRepo.pinnedCommitSha
    ) {
      triggerBehavioralGradingInBackground(
        submission._id.toString(),
        "submitSubmissionByToken"
      );
    }

    res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Finalize a timed-out submission by token using screen recording only.
 * No code repository is required for this path.
 */
export const submitRecordingOnlyByToken: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { token } = req.params;

    const submission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (
      (submission.status === "submitted" || submission.status === "expired") &&
      submission.submittedAt
    ) {
      const alreadySubmitted = await SubmissionModel.findOne({ token }).populate(
        "assessmentId",
        "title description timeLimit"
      );
      return res.status(200).json(alreadySubmitted);
    }

    const assessment = submission.assessmentId as any;
    const timing = getSubmissionTimingWindow(submission, assessment);

    // This endpoint is only valid after the main assessment timer has elapsed.
    if (timing.elapsedMinutes !== null) {
      if (!timing.isLate) {
        return res.status(400).json({
          error:
            "Recording-only submission is only available after the assessment time limit has elapsed.",
        });
      }
      submission.timeSpent = Math.floor(timing.elapsedMinutes);
    }

    submission.status = "expired";
    submission.submittedAt = new Date();
    await submission.save();

    const submissionIdStr = submission._id.toString();
    const hasEvaluationCriteria =
      Array.isArray(assessment?.evaluationCriteria) &&
      assessment.evaluationCriteria.length > 0;

    if (hasEvaluationCriteria) {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: { evaluationStatus: "pending", evaluationError: null },
      });
      ensureProctoringTranscriptAndEvaluate(submissionIdStr)
        .then(async () => {
          const sub = await SubmissionModel.findById(submissionIdStr);
          if (!sub) return;
          (sub as any).evaluationStatus = (sub as any).evaluationReport
            ? "completed"
            : "failed";
          await sub.save();
        })
        .catch((err) => {
          console.error(
            `[submitRecordingOnlyByToken] ensureProctoringTranscriptAndEvaluate failed for ${submission._id}:`,
            err
          );
          SubmissionModel.findByIdAndUpdate(submissionIdStr, {
            $set: {
              evaluationStatus: "failed",
              evaluationError:
                err instanceof Error ? err.message : "Evaluation failed.",
            },
          }).catch(() => {});
        });
    } else {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: {
          evaluationStatus: "failed",
          evaluationError: "Assessment has no evaluation criteria configured.",
        },
      });
    }

    const updatedSubmission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId",
      "title description timeLimit"
    );
    return res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Upload and submit code archive by token (public endpoint)
 */
export const uploadSubmissionByToken: RequestHandler = async (req, res, next) => {
  try {
    if (!isUploadSubmissionEnabled()) {
      return res.status(403).json({
        error: "Archive uploads are currently disabled.",
      });
    }
    const { token } = req.params;
    const archive = req.file;

    if (!archive) {
      return res.status(400).json({ error: "Archive file is required" });
    }
    if (!looksLikeZipArchive(archive)) {
      return res
        .status(400)
        .json({ error: "Only .zip archives are supported" });
    }

    const submission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status === "submitted") {
      return res
        .status(400)
        .json({ error: "Assessment has already been submitted" });
    }

    // Validate time limit server-side (same semantics as GitHub submit endpoint)
    const assessment = submission.assessmentId as any;
    const timing = getSubmissionTimingWindow(submission, assessment);
    if (timing.elapsedMinutes !== null) {
      submission.timeSpent = Math.floor(timing.elapsedMinutes);
      if (timing.isBeyondGrace) {
        return res.status(400).json({
          error:
            "Submission window has closed. You ran out of time and missed the 5-minute grace period.",
        });
      }
      if (timing.isLate) {
        submission.status = "expired";
      }
    }

    const submissionCodeStorage = getSubmissionCodeStorage();
    const sha256 = createHash("sha256").update(archive.buffer).digest("hex");
    const storageKey = `${submission._id.toString()}/archives/${Date.now()}-${randomUUID()}.zip`;
    await submissionCodeStorage.storeArchive(storageKey, archive.buffer);

    submission.codeSource = "upload";
    submission.codeUpload = {
      storageKey,
      originalFilename: archive.originalname || "submission.zip",
      sizeBytes: archive.size,
      sha256,
      uploadedAt: new Date(),
    } as any;
    submission.githubLink = null;
    submission.githubRepo = {
      owner: null,
      repo: null,
      refType: null,
      ref: null,
      pinnedCommitSha: null,
    } as any;
    submission.status =
      submission.status === "expired" ? "expired" : "submitted";
    submission.submittedAt = new Date();

    await submission.save();

    const updatedSubmission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId",
      "title description timeLimit"
    );

    // Keep evaluation behavior aligned with GitHub submit flow.
    const submissionIdStr = submission._id.toString();
    const hasEvaluationCriteria =
      Array.isArray(assessment?.evaluationCriteria) &&
      assessment.evaluationCriteria.length > 0;
    if (hasEvaluationCriteria) {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: { evaluationStatus: "pending", evaluationError: null },
      });
      ensureProctoringTranscriptAndEvaluate(submissionIdStr)
        .then(async () => {
          const sub = await SubmissionModel.findById(submissionIdStr);
          if (!sub) return;
          (sub as any).evaluationStatus = (sub as any).evaluationReport
            ? "completed"
            : "failed";
          await sub.save();
        })
        .catch((err) => {
          console.error(
            `[uploadSubmissionByToken] ensureProctoringTranscriptAndEvaluate failed for ${submission._id}:`,
            err
          );
          SubmissionModel.findByIdAndUpdate(submissionIdStr, {
            $set: {
              evaluationStatus: "failed",
              evaluationError:
                err instanceof Error ? err.message : "Evaluation failed.",
            },
          }).catch(() => {});
        });
    } else {
      await SubmissionModel.findByIdAndUpdate(submissionIdStr, {
        $set: {
          evaluationStatus: "failed",
          evaluationError: "Assessment has no evaluation criteria configured.",
        },
      });
    }

    // Trigger indexing in background (source-aware in snapshot abstraction).
    indexSubmissionRepo(submissionIdStr).catch((error) => {
      console.error(
        `[uploadSubmissionByToken] Failed to index repository for submission ${submission._id}:`,
        error
      );
    });

    // Task execution remains conditioned on trace presence.
    if (submission.llmWorkflow?.trace?.events?.length > 0) {
      executeAllTasks(submission._id.toString())
        .then(async (results) => {
          const sub = await SubmissionModel.findById(submission._id);
          if (!sub) return;
          if (!sub.llmWorkflow) {
            sub.llmWorkflow = {
              trace: {
                sessionId: "",
                events: [],
                totalTokens: 0,
                totalCost: 0,
                totalTime: 0,
                totalCalls: 0,
              },
              taskResults: [],
              scores: {},
              evaluation: {
                harnessVersion: "1.0.0",
                tasksCompleted: 0,
                tasksTotal: 0,
              },
            };
          }
          sub.llmWorkflow.taskResults = results;
          sub.llmWorkflow.evaluation = sub.llmWorkflow.evaluation ?? {
            harnessVersion: "1.0.0",
            tasksCompleted: 0,
            tasksTotal: 0,
          };
          sub.llmWorkflow.evaluation.tasksCompleted = results.filter(
            (r: { status: string }) => r.status === "passed"
          ).length;
          sub.llmWorkflow.evaluation.tasksTotal = results.length;
          await sub.save();
        })
        .catch((error) => {
          console.error(
            `[uploadSubmissionByToken] Failed to execute tasks for submission ${submission._id}:`,
            error
          );
        });
    }

    triggerBehavioralGradingInBackground(
      submission._id.toString(),
      "submitSubmissionByToken"
    );

    res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Final submission (public endpoint)
 */
export const submitSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { id } = req.params;
    const { githubLink, timeSpent } = req.body as SubmitSubmissionRequest;

    const submission = await SubmissionModel.findById(id).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Don't allow resubmission
    if (submission.status === "submitted") {
      return res
        .status(400)
        .json({ error: "Assessment has already been submitted" });
    }

    // Check if time limit has been exceeded
    const assessment = submission.assessmentId as any;
    const timing = getSubmissionTimingWindow(submission, assessment);
    if (timing.elapsedMinutes !== null) {
      submission.timeSpent = Math.floor(timing.elapsedMinutes);
      if (timing.isBeyondGrace) {
        return res.status(400).json({
          error:
            "Submission window has closed. You ran out of time and missed the 5-minute grace period.",
        });
      }
      if (timing.isLate) {
        // Still allow submission but mark as expired (within grace window)
        submission.status = "expired";
      }
    } else if (assessment && assessment.timeLimit) {
      const timeElapsed = timeSpent || submission.timeSpent;
      if (timeElapsed > assessment.timeLimit) {
        submission.status = "expired";
      }
    }

    // Parse and resolve GitHub repository information
    try {
      const parsedRepo = parseGithubRepoUrl(githubLink);
      const resolvedRepo = await resolvePinnedCommit(parsedRepo);

      // Update submission with GitHub link and resolved repository information
      submission.githubLink = githubLink;
      submission.githubRepo = {
        owner: resolvedRepo.owner,
        repo: resolvedRepo.repo,
        refType: resolvedRepo.refType,
        ref: resolvedRepo.ref,
        pinnedCommitSha: resolvedRepo.pinnedCommitSha,
      };
    } catch (error) {
      // If GitHub parsing/resolution fails, return error to user
      // This includes private repo errors, invalid URLs, etc.
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process GitHub repository URL",
      });
    }

    if (timeSpent !== undefined) {
      submission.timeSpent = timeSpent;
    }
    submission.status =
      submission.status === "expired" ? "expired" : "submitted";
    submission.submittedAt = new Date();

    await submission.save();

    const updatedSubmission = await SubmissionModel.findById(id).populate(
      "assessmentId",
      "title description timeLimit"
    );

    // Background: generate proctoring transcript if needed, then run screen-recording evaluation
    ensureProctoringTranscriptAndEvaluate(submission._id.toString()).catch(
      (err) =>
        console.error(
          `[submitSubmission] ensureProctoringTranscriptAndEvaluate failed for ${submission._id}:`,
          err
        )
    );

    // Trigger repository indexing in the background (fire-and-forget)
    // This doesn't block the submission response
    if (
      submission.githubRepo &&
      submission.githubRepo.owner &&
      submission.githubRepo.repo &&
      submission.githubRepo.pinnedCommitSha
    ) {
      indexSubmissionRepo(submission._id.toString()).catch((error) => {
        // Log error but don't fail the submission
        console.error(
          `[submitSubmission] Failed to index repository for submission ${submission._id}:`,
          error
        );
      });
    }

    // Trigger behavioral grading after submission (public repos only in v1)
    if (
      submission.githubRepo &&
      submission.githubRepo.owner &&
      submission.githubRepo.repo &&
      submission.githubRepo.pinnedCommitSha
    ) {
      triggerBehavioralGradingInBackground(
        submission._id.toString(),
        "submitSubmission"
      );
    }

    res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all submissions for an assessment (employer only - auth required)
 */
export const getSubmissionsForAssessment: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { uid } = req.body as { uid: string };
    const { id: assessmentId } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify assessment belongs to user
    const assessment = await AssessmentModel.findOne({
      _id: assessmentId,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN; // Don't reveal if assessment exists
    }

    // Get all submissions for this assessment (lean = plain objects so nested llmWorkflow.trace.events serialize correctly)
    const submissions = await SubmissionModel.find({ assessmentId })
      .sort({
        submittedAt: -1,
        createdAt: -1,
      })
      .lean();

    // Backfill workflow scores when an LLM trace exists but scores were not saved yet
    const MAX_SCORE_BACKFILL = 8;
    let scheduled = 0;
    for (const sub of submissions) {
      if (scheduled >= MAX_SCORE_BACKFILL) break;
      if (sub.status !== "submitted" && sub.status !== "expired") continue;
      const wf = (sub as any).llmWorkflow;
      if (!wf?.trace?.events?.length) continue;
      if (wf?.scores?.overall?.score != null) continue;

      scheduled++;
      calculateAndSaveScores(sub._id.toString()).catch((err) => {
        console.warn(
          `[getSubmissionsForAssessment] Workflow score backfill failed for ${sub._id}:`,
          err
        );
      });
    }

    res.status(200).json(submissions);
  } catch (error) {
    next(error);
  }
};

/**
 * ZIP export of employer-visible submission evidence: per-submission metadata,
 * evaluation + behavioral JSON reports, and behavioral grading artifacts from disk.
 * GET /api/submissions/assessments/:assessmentId/evidence-export
 */
export const exportAssessmentEvidenceZip: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { uid } = req.body as { uid: string };
    const { assessmentId } = req.params;

    const userId = await getUserIdFromFirebaseUid(uid);

    const assessment = await AssessmentModel.findOne({
      _id: assessmentId,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const submissions = await SubmissionModel.find({ assessmentId }).lean();

    const storage = getGradingEvidenceStorage();
    const filename = `assessment-${assessmentId}-submission-evidence.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`
    );

    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("warning", (err) => {
      console.warn("[exportAssessmentEvidenceZip]", err);
    });
    archive.on("error", (err) => {
      if (!res.headersSent) {
        next(err);
      } else {
        res.end();
      }
    });

    archive.pipe(res);

    const manifest = {
      assessmentId,
      assessmentTitle: assessment.title,
      exportedAt: new Date().toISOString(),
      submissionCount: submissions.length,
    };
    archive.append(JSON.stringify(manifest, null, 2), {
      name: "export-manifest.json",
    });

    for (const sub of submissions) {
      const sid = sub._id.toString();
      const base = `${sid}/`;

      const meta = {
        submissionId: sid,
        candidateName: sub.candidateName,
        candidateEmail: sub.candidateEmail,
        status: sub.status,
        behavioralGradingStatus: sub.behavioralGradingStatus,
        behavioralGradingError: sub.behavioralGradingError,
        evaluationStatus: sub.evaluationStatus,
        evaluationError: sub.evaluationError,
        submittedAt: sub.submittedAt,
        createdAt: sub.createdAt,
      };
      archive.append(JSON.stringify(meta, null, 2), {
        name: `${base}submission-meta.json`,
      });

      const evalReport = (sub as { evaluationReport?: unknown }).evaluationReport;
      if (evalReport != null) {
        archive.append(JSON.stringify(evalReport, null, 2), {
          name: `${base}evaluation-report.json`,
        });
      }

      const behReport = (sub as { behavioralGradingReport?: unknown })
        .behavioralGradingReport;
      if (behReport != null) {
        archive.append(JSON.stringify(behReport, null, 2), {
          name: `${base}behavioral-grading-report.json`,
        });

        const keys = collectBehavioralArtifactKeys(behReport, sid);
        let missingIdx = 0;
        for (const key of keys) {
          if (await storage.exists(key)) {
            const buf = await storage.readArtifact(key);
            const relative = key.slice(`submissions/${sid}/`.length);
            archive.append(buf, {
              name: `${base}grading-artifacts/${relative}`,
            });
          } else {
            missingIdx += 1;
            archive.append(`Artifact not found on server: ${key}\n`, {
              name: `${base}grading-artifacts/_missing-${missingIdx}.txt`,
            });
          }
        }
      }
    }

    await archive.finalize();
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a submission (employer only - auth required)
 */
export const deleteSubmission: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };
    const { submissionId } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Get submission and verify it belongs to user's assessment
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (!assessment || assessment.userId.toString() !== userId) {
      throw AuthError.INVALID_AUTH_TOKEN; // Don't reveal if submission exists
    }

    // Step 1: Find and delete Pinecone data if it exists
    const repoIndex = await RepoIndexModel.findOne({ submissionId });
    if (repoIndex && repoIndex.pinecone) {
      try {
        await deleteNamespace(
          repoIndex.pinecone.indexName,
          repoIndex.pinecone.namespace
        );
        console.log(
          `✅ [deleteSubmission] Deleted Pinecone namespace ${repoIndex.pinecone.namespace} for submission ${submissionId}`
        );
      } catch (pineconeError) {
        // Log error but don't fail the deletion - Pinecone cleanup is best effort
        console.error(
          `⚠️ [deleteSubmission] Failed to delete Pinecone namespace for submission ${submissionId}:`,
          pineconeError
        );
      }
    }

    // Step 2: Delete RepoIndex record from MongoDB
    if (repoIndex) {
      await RepoIndexModel.findByIdAndDelete(repoIndex._id);
      console.log(
        `✅ [deleteSubmission] Deleted RepoIndex record for submission ${submissionId}`
      );
    }

    // Step 3: Delete the submission from MongoDB
    await SubmissionModel.findByIdAndDelete(submissionId);

    res.status(200).json({ message: "Submission deleted successfully" });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a public assessment by ID (for candidate to view before starting)
 */
export const getPublicAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const assessment = await AssessmentModel.findById(id).select(
      "title description timeLimit"
    );

    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    res.status(200).json(assessment);
  } catch (error) {
    next(error);
  }
};

/**
 * Generate interview questions from a submitted repository by token (public endpoint - for candidates)
 */
export const generateInterviewQuestionsByToken: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { token } = req.params;

    // Get submission by token
    const submission = await SubmissionModel.findOne({ token }).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Verify submission is submitted
    if (submission.status !== "submitted" && submission.status !== "expired") {
      return res.status(400).json({
        error:
          "Interview questions can only be generated for submitted assessments",
      });
    }

    // Verify submission has code source metadata (GitHub or uploaded archive)
    const hasGithubSource =
      submission.codeSource !== "upload" &&
      submission.githubRepo?.owner &&
      submission.githubRepo?.repo &&
      submission.githubRepo?.pinnedCommitSha;
    const hasUploadSource =
      submission.codeSource === "upload" && submission.codeUpload?.storageKey;
    if (!hasGithubSource && !hasUploadSource) {
      return res.status(400).json({
        error: "Code submission information not found for this submission",
      });
    }

    const assessment = submission.assessmentId as any;

    // Validate assessment description exists
    if (!assessment.description || !assessment.description.trim()) {
      return res.status(400).json({
        error:
          "Assessment description is required to generate interview questions",
      });
    }

    // Interview pipeline is off unless explicitly enabled on the assessment
    const isSmartInterviewerEnabled =
      (assessment as any).isSmartInterviewerEnabled === true;

    if (!isSmartInterviewerEnabled) {
      return res.status(403).json({
        error: "Smart AI Interviewer is disabled for this assessment",
      });
    }

    // Generate interview questions using Pinecone retrieval
    let validatedQuestions;
    let retrievedChunkCount: number = 0;
    let chunkPaths: string[] = [];

    try {
      console.log(
        "🔄 [generateInterviewQuestionsByToken] Starting interview question generation with retrieval..."
      );
      const numQuestions = (assessment as any).numInterviewQuestions ?? 2;
      const customInstructions = (assessment as any)
        .interviewerCustomInstructions;
      const result = await generateInterviewQuestionsFromRetrieval(
        submission._id.toString(),
        assessment.description,
        numQuestions,
        customInstructions
      );
      validatedQuestions = result.questions;
      retrievedChunkCount = result.retrievedChunkCount;
      chunkPaths = result.chunkPaths;
      console.log(
        `✅ [generateInterviewQuestionsByToken] Question generation completed. Received ${
          validatedQuestions?.length || 0
        } questions from ${retrievedChunkCount} code chunks`
      );
    } catch (error) {
      console.error("Failed to generate interview questions:", error);

      // Handle specific errors
      if (error instanceof Error) {
        if (
          error.message === "Repo indexed but no relevant code chunks found"
        ) {
          return res.status(409).json({
            error: error.message,
          });
        }
        if (error.message.includes("Assessment description is required")) {
          return res.status(400).json({
            error: error.message,
          });
        }
        if (error.message.includes("Repo not indexed yet")) {
          return res.status(409).json({
            error: error.message,
          });
        }
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate interview questions",
      });
    }

    // Validate questions were generated
    if (!validatedQuestions || validatedQuestions.length === 0) {
      console.error(
        "❌ [generateInterviewQuestionsByToken] No questions generated or questions array is empty"
      );
      return res.status(500).json({
        error: "No interview questions were generated",
      });
    }

    // Questions are already validated and in the correct format
    // Add createdAt if not present
    const questionsWithTimestamps = validatedQuestions.map((q) => ({
      prompt: q.prompt,
      anchors: q.anchors,
      createdAt: new Date(),
    }));

    console.log(
      `🔄 [generateInterviewQuestionsByToken] Saving ${questionsWithTimestamps.length} questions to submission ${submission._id}...`
    );
    submission.interviewQuestions = questionsWithTimestamps;
    // Mark the array as modified to ensure Mongoose saves it
    submission.markModified("interviewQuestions");

    try {
      await submission.save();
      console.log(
        `✅ [generateInterviewQuestionsByToken] Submission save completed`
      );
    } catch (saveError) {
      console.error(
        "❌ [generateInterviewQuestionsByToken] Failed to save submission:",
        saveError
      );
      throw saveError;
    }

    // Verify the save by reloading
    const savedSubmission = await SubmissionModel.findById(submission._id);
    console.log(
      `✅ [generateInterviewQuestionsByToken] Saved ${questionsWithTimestamps.length} interview questions to submission ${submission._id}`
    );
    console.log(
      `   [generateInterviewQuestionsByToken] Verified: ${
        savedSubmission?.interviewQuestions?.length || 0
      } questions in database`
    );

    res.status(200).json({
      questions: questionsWithTimestamps,
      submissionId: submission._id.toString(),
      candidateName: submission.candidateName,
      retrievedChunkCount,
      chunkPaths,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate interview questions from a submitted repository (employer endpoint - auth required)
 */
export const generateInterviewQuestions: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { uid } = req.body as { uid: string };
    const { submissionId } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Get submission and verify it belongs to user's assessment
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;

    // Verify assessment belongs to user
    if (assessment.userId.toString() !== userId) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Verify submission is submitted
    if (submission.status !== "submitted" && submission.status !== "expired") {
      return res.status(400).json({
        error:
          "Interview questions can only be generated for submitted assessments",
      });
    }

    // Verify submission has code source metadata (GitHub or uploaded archive)
    const hasGithubSource =
      submission.codeSource !== "upload" &&
      submission.githubRepo?.owner &&
      submission.githubRepo?.repo &&
      submission.githubRepo?.pinnedCommitSha;
    const hasUploadSource =
      submission.codeSource === "upload" && submission.codeUpload?.storageKey;
    if (!hasGithubSource && !hasUploadSource) {
      return res.status(400).json({
        error: "Code submission information not found for this submission",
      });
    }

    // Validate assessment description exists
    if (!assessment.description || !assessment.description.trim()) {
      return res.status(400).json({
        error:
          "Assessment description is required to generate interview questions",
      });
    }

    const isSmartInterviewerEnabled =
      (assessment as any).isSmartInterviewerEnabled === true;

    if (!isSmartInterviewerEnabled) {
      return res.status(403).json({
        error: "Smart AI Interviewer is disabled for this assessment",
      });
    }

    // Generate interview questions using Pinecone retrieval
    let validatedQuestions;
    let retrievedChunkCount: number = 0;
    let chunkPaths: string[] = [];

    try {
      console.log(
        "🔄 [generateInterviewQuestions] Starting interview question generation with retrieval..."
      );
      const numQuestions = (assessment as any).numInterviewQuestions ?? 2;
      const customInstructions = (assessment as any)
        .interviewerCustomInstructions;
      const result = await generateInterviewQuestionsFromRetrieval(
        submissionId,
        assessment.description,
        numQuestions,
        customInstructions
      );
      validatedQuestions = result.questions;
      retrievedChunkCount = result.retrievedChunkCount;
      chunkPaths = result.chunkPaths;
      console.log(
        `✅ [generateInterviewQuestions] Question generation completed. Received ${
          validatedQuestions?.length || 0
        } questions from ${retrievedChunkCount} code chunks`
      );
    } catch (error) {
      console.error("Failed to generate interview questions:", error);

      // Handle specific errors
      if (error instanceof Error) {
        if (
          error.message === "Repo indexed but no relevant code chunks found"
        ) {
          return res.status(409).json({
            error: error.message,
          });
        }
        if (error.message.includes("Assessment description is required")) {
          return res.status(400).json({
            error: error.message,
          });
        }
        if (error.message.includes("Repo not indexed yet")) {
          return res.status(409).json({
            error: error.message,
          });
        }
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate interview questions",
      });
    }

    // Validate questions were generated
    if (!validatedQuestions || validatedQuestions.length === 0) {
      console.error(
        "❌ [generateInterviewQuestions] No questions generated or questions array is empty"
      );
      return res.status(500).json({
        error: "No interview questions were generated",
      });
    }

    // Questions are already validated and in the correct format
    // Add createdAt if not present
    const questionsWithTimestamps = validatedQuestions.map((q) => ({
      prompt: q.prompt,
      anchors: q.anchors,
      createdAt: new Date(),
    }));

    console.log(
      `🔄 [generateInterviewQuestions] Saving ${questionsWithTimestamps.length} questions to submission ${submission._id}...`
    );
    submission.interviewQuestions = questionsWithTimestamps;
    // Mark the array as modified to ensure Mongoose saves it
    submission.markModified("interviewQuestions");

    try {
      await submission.save();
      console.log(`✅ [generateInterviewQuestions] Submission save completed`);
    } catch (saveError) {
      console.error(
        "❌ [generateInterviewQuestions] Failed to save submission:",
        saveError
      );
      throw saveError;
    }

    // Verify the save by reloading
    const savedSubmission = await SubmissionModel.findById(submission._id);
    console.log(
      `✅ [generateInterviewQuestions] Saved ${questionsWithTimestamps.length} interview questions to submission ${submission._id}`
    );
    console.log(
      `   [generateInterviewQuestions] Verified: ${
        savedSubmission?.interviewQuestions?.length || 0
      } questions in database`
    );

    res.status(200).json({
      questions: questionsWithTimestamps,
      submissionId: submission._id.toString(),
      candidateName: submission.candidateName,
      retrievedChunkCount,
      chunkPaths,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get interview agent prompt for a submission (public endpoint - auth disabled for testing)
 * Returns a formatted system prompt string that can be used with ElevenLabs agent
 */
export const getInterviewAgentPrompt: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;

    // Load the Submission
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Check if interview questions exist
    if (
      !submission.interviewQuestions ||
      submission.interviewQuestions.length === 0
    ) {
      return res.status(409).json({
        error: "Generate interview questions first",
      });
    }

    // Extract question prompts and format as numbered list
    const questionsList = submission.interviewQuestions
      .map((q, index) => `${index + 1}. ${q.prompt}`)
      .join("\n");

    // Get custom instructions if available
    const assessment = submission.assessmentId as any;
    const customInstructions = assessment?.interviewerCustomInstructions;

    // Build prompt using centralized prompt template
    const prompt = PROMPT_INTERVIEW_AGENT.template(
      submission.interviewQuestions.length,
      questionsList,
      customInstructions
    );

    res.status(200).json({
      prompt,
      questionCount: submission.interviewQuestions.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Index a submission's repository into Pinecone
 * POST /api/submissions/:submissionId/index-repo
 */
export const indexSubmissionRepository: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const result = await indexSubmissionRepo(submissionId);

    res.status(200).json({
      status: result.status,
      chunkCount: result.chunkCount,
      fileCount: result.fileCount,
      error: result.error,
    });
  } catch (error) {
    console.error("Error indexing repository:", error);
    next(error);
  }
};

/**
 * Get repository indexing status
 * GET /api/submissions/:submissionId/repo-index/status
 */
export const getRepoIndexStatus: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = req.params;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const submission = await SubmissionModel.findById(submissionId);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const source = submission.codeSource === "upload" ? "upload" : "github";
    const repoIndex = await RepoIndexModel.findOne({ submissionId: submission._id, source }).sort({
      updatedAt: -1,
    });

    if (!repoIndex) {
      return res.status(404).json({
        error: "Repository index not found",
        status: "not_indexed",
      });
    }

    res.status(200).json({
      status: repoIndex.status,
      stats: repoIndex.stats,
      error: repoIndex.error,
      updatedAt: repoIndex.updatedAt,
      createdAt: repoIndex.createdAt,
    });
  } catch (error) {
    console.error("Error getting repo index status:", error);
    next(error);
  }
};

/**
 * Update interview conversationId for a submission
 * PATCH /api/submissions/:submissionId/interview-conversation-id
 * Public endpoint - no auth required (called from frontend when interview starts)
 */
export const updateInterviewConversationId: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const { conversationId } = req.body as { conversationId: string };

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    const submission = await SubmissionModel.findById(submissionId);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Initialize interview object if it doesn't exist
    if (!submission.interview) {
      (submission as any).interview = {};
    }

    // Update conversationId and status
    (submission as any).interview.conversationId = conversationId;
    (submission as any).interview.status = "in_progress";
    (submission as any).interview.provider = "elevenlabs";
    (submission as any).interview.startedAt = new Date();
    (submission as any).interview.updatedAt = new Date();

    submission.markModified("interview");
    await submission.save();

    console.log(
      `✅ [updateInterviewConversationId] Stored conversationId ${conversationId} for submission ${submissionId}`
    );

    res.status(200).json({
      message: "Conversation ID updated",
      submissionId,
      conversationId,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search code chunks for a submission
 * POST /api/submissions/:submissionId/search-code
 */
export const searchCode: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { query, topK } = req.body;

    // Validate submissionId
    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    // Validate query
    if (!query || typeof query !== "string" || !query.trim()) {
      return res
        .status(400)
        .json({ error: "query is required and must be a non-empty string" });
    }

    // Optional: Verify submission exists (but this isn't strictly required)
    const submission = await SubmissionModel.findById(submissionId);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Search code chunks
    const result = await searchCodeChunks(submissionId, query.trim(), {
      topK: topK ? Number(topK) : undefined,
    });

    res.status(200).json({
      chunks: result.chunks,
      stats: result.stats,
    });
  } catch (error) {
    // Handle specific errors
    if (error instanceof Error) {
      if (error.message === "Repo not indexed yet") {
        return res.status(409).json({ error: error.message });
      }
      if (error.message.includes("required")) {
        return res.status(400).json({ error: error.message });
      }
    }

    console.error("Error searching code:", error);
    next(error);
  }
};

export type GenerateShareLinkRequest = {
  assessmentId: string;
  candidateName: string;
  candidateEmail?: string;
  uid: string; // Added by verifyAuthToken middleware
};

/**
 * Generate a share link for a candidate (employer endpoint - auth required)
 * Creates a submission with status "pending" and returns the shareable link
 */
export const generateShareLink: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { assessmentId, candidateName, candidateEmail, uid } =
      req.body as GenerateShareLinkRequest;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify assessment exists and belongs to the user
    const assessment = await AssessmentModel.findOne({
      _id: assessmentId,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN; // Don't reveal if assessment exists
    }

    // Create submission with status "pending"
    // Token will be auto-generated by the model
    const submission = await SubmissionModel.create({
      assessmentId,
      candidateName: candidateName.trim(),
      ...(candidateEmail && { candidateEmail: candidateEmail.trim().toLowerCase() }),
      status: "pending",
      // startedAt will be null until candidate starts
    });

    // Generate shareable link (production → https://app.bridge-jobs.com unless SHARE_LINK_BASE_URL)
    const shareLink = `${getShareLinkBaseUrl()}/CandidateAssessment?token=${submission.token}`;

    res.status(201).json({
      token: submission.token,
      shareLink,
      submissionId: submission._id,
      candidateName: submission.candidateName,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Opt out of the assessment (public endpoint - by token)
 */
export const optOutByToken: RequestHandler = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { reason } = req.body as { reason?: string };

    const submission = await SubmissionModel.findOne({ token });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Don't allow opting out if already submitted
    if (submission.status === "submitted") {
      return res
        .status(400)
        .json({ error: "Cannot opt out of a submitted assessment" });
    }

    // Update submission
    submission.optedOut = true;
    submission.optOutReason = reason || null;
    submission.optedOutAt = new Date();
    submission.status = "opted-out";

    await submission.save();

    const updatedSubmission = await SubmissionModel.findById(
      submission._id
    ).populate("assessmentId", "title description timeLimit");

    res.status(200).json(updatedSubmission);
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate workflow scores for a submission
 * POST /api/submissions/:submissionId/calculate-workflow-scores
 * Employer only (auth required)
 */
export const calculateWorkflowScoresHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const uid = (req as any).user?.uid;

    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify ownership
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Calculate workflow scores
    const { calculateWorkflowScores } = await import(
      "../services/workflowScoring/workflowScorer.js"
    );
    const scores = await calculateWorkflowScores(submissionId);

    // Save scores to submission
    submission.llmWorkflow = submission.llmWorkflow || {
      trace: { sessionId: "", events: [], totalTokens: 0, totalCost: 0, totalTime: 0, totalCalls: 0 },
      taskResults: [],
      scores: {},
      evaluation: { harnessVersion: "1.0.0", tasksCompleted: 0, tasksTotal: 0 },
    };
    submission.llmWorkflow.scores = scores;
    submission.llmWorkflow.scores.calculatedAt = new Date();
    submission.llmWorkflow.scores.calculationVersion = "1.0.0";
    const subAny = submission as any;
    subAny.scores = subAny.scores || {};
    subAny.scores.overall = scores.overall.score;
    subAny.scores.calculatedAt = new Date();
    subAny.scores.calculationVersion = "2.0.0";
    await submission.save();

    res.json(scores);
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate workflow scores (5D + overall) when an LLM trace exists
 * POST /api/submissions/:submissionId/calculate-scores
 * Employer only (auth required)
 */
export const calculateScoresHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const uid = (req as any).user?.uid;

    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);

    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { calculateAndSaveScores } = await import(
      "../services/scoring.js"
    );
    const result = await calculateAndSaveScores(submissionId);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Trigger behavioral grading (manual re-run)
 * POST /api/submissions/:submissionId/grade-behavioral
 * Employer only (auth required)
 */
export const gradeBehavioralHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!isBehavioralGradingEnabled()) {
      return res.status(503).json({
        error:
          "Behavioral grading (E2B) is currently disabled. Set BEHAVIORAL_GRADING_ENABLED=true on the server to enable.",
      });
    }

    triggerBehavioralGradingInBackground(submissionId, "manual");

    return res.status(202).json({
      message: "Behavioral grading queued.",
      submissionId,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Read a behavioral grading artifact (employer only)
 * GET /api/submissions/:submissionId/behavioral-artifact?key=<artifactKey>
 */
export const getBehavioralArtifactHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const key = String(req.query.key || "");
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!key) {
      return res.status(400).json({ error: "Missing artifact key" });
    }
    if (!key.startsWith(`submissions/${submissionId}/`)) {
      return res.status(400).json({ error: "Invalid artifact key scope" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const storage = getGradingEvidenceStorage();
    if (!(await storage.exists(key))) {
      return res.status(404).json({ error: "Artifact not found" });
    }

    const ext = path.extname(key).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".json"
        ? "application/json"
        : "application/octet-stream";

    const data = await storage.readArtifact(key);
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));
  } catch (error) {
    next(error);
  }
};

/**
 * Download uploaded code archive for a submission (employer only)
 * GET /api/submissions/:submissionId/code-archive
 */
export const getSubmissionCodeArchiveHandler: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const { submissionId } = req.params;
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    const assessment = submission.assessmentId as any;
    if (assessment.userId.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (submission.codeSource !== "upload" || !submission.codeUpload?.storageKey) {
      return res.status(400).json({
        error: "No uploaded archive found for this submission",
      });
    }

    const storage = getSubmissionCodeStorage();
    const exists = await storage.exists(submission.codeUpload.storageKey);
    if (!exists) {
      return res.status(404).json({ error: "Archive not found" });
    }

    const archive = await storage.readArchive(submission.codeUpload.storageKey);
    const fallbackName = `submission-${submission._id.toString()}.zip`;
    const fileName =
      submission.codeUpload.originalFilename?.trim() || fallbackName;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/"/g, "")}"`
    );
    return res.status(200).send(Buffer.from(archive));
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Bulk candidate invite types
// ---------------------------------------------------------------------------

export type BulkGenerateLinksRequest = {
  assessmentId: string;
  candidates: Array<{ name: string; email: string }>;
  uid: string; // Added by verifyAuthToken middleware
};

export type SendInvitesRequest = {
  submissionIds: string[];
  uid: string; // Added by verifyAuthToken middleware
};

// ---------------------------------------------------------------------------
// bulkGenerateLinks
// ---------------------------------------------------------------------------

/**
 * Bulk generate share links for multiple candidates (employer endpoint - auth required).
 * Creates one Submission per candidate (skips duplicates with status "pending").
 * POST /api/submissions/bulk-generate-links
 */
export const bulkGenerateLinks: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { assessmentId, candidates, uid } =
      req.body as BulkGenerateLinksRequest;

    // Resolve MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Verify the assessment exists and belongs to this user
    const assessment = await AssessmentModel.findOne({
      _id: assessmentId,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN; // Don't reveal whether assessment exists
    }

    const appUrl = getShareLinkBaseUrl();

    const results: Array<{
      submissionId: string;
      token: string;
      shareLink: string;
      candidateName: string;
      candidateEmail: string;
    }> = [];

    for (const candidate of candidates) {
      const normalizedEmail = candidate.email.toLowerCase().trim();

      // Check for an existing pending submission for this email + assessment
      const existing = await SubmissionModel.findOne({
        assessmentId,
        candidateEmail: normalizedEmail,
        status: "pending",
      });

      if (existing) {
        // Return the existing submission rather than creating a duplicate
        const shareLink = `${appUrl}/CandidateAssessment?token=${existing.token}`;
        results.push({
          submissionId: existing._id.toString(),
          token: existing.token,
          shareLink,
          candidateName: existing.candidateName ?? candidate.name,
          candidateEmail: normalizedEmail,
        });
        continue;
      }

      const submission = await SubmissionModel.create({
        assessmentId,
        candidateName: candidate.name.trim(),
        candidateEmail: normalizedEmail,
        status: "pending",
      });

      const shareLink = `${appUrl}/CandidateAssessment?token=${submission.token}`;
      results.push({
        submissionId: submission._id.toString(),
        token: submission.token,
        shareLink,
        candidateName: submission.candidateName ?? candidate.name,
        candidateEmail: normalizedEmail,
      });
    }

    res.status(201).json({ submissions: results });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// sendInvites
// ---------------------------------------------------------------------------

/**
 * Send invite emails to candidates for existing submissions (employer endpoint - auth required).
 * Sends all emails in parallel via Promise.allSettled.
 * POST /api/submissions/send-invites
 */
export const sendInvites: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);

    const { submissionIds, uid } = req.body as SendInvitesRequest;

    // Resolve MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    const appUrl = getShareLinkBaseUrl();

    const { sendCandidateInvite } = await import("../services/email.js");

    // Build a send task for each submission ID
    const sendTasks = submissionIds.map(async (submissionId) => {
      // Look up submission and populate assessment for ownership check + title
      const submission = await SubmissionModel.findById(submissionId).populate<{
        assessmentId: { _id: unknown; userId: unknown; title: string };
      }>("assessmentId");

      if (!submission) {
        throw new Error(`Submission not found: ${submissionId}`);
      }

      // Verify ownership: the assessment must belong to the authenticated user
      const assessment = submission.assessmentId as {
        _id: unknown;
        userId: unknown;
        title: string;
      };
      if (!assessment || assessment.userId?.toString() !== userId) {
        throw new Error(
          `Access denied for submission: ${submissionId}`
        );
      }

      if (!submission.candidateEmail) {
        throw new Error(
          `No email address on submission: ${submissionId}`
        );
      }

      const shareLink = `${appUrl}/CandidateAssessment?token=${submission.token}`;
      const assessmentTitle = assessment.title ?? "Technical Assessment";

      const result = await sendCandidateInvite(
        submission.candidateEmail,
        submission.candidateName ?? "Candidate",
        assessmentTitle,
        shareLink
      );

      if (!result.success) {
        throw new Error(result.error ?? "Email send failed");
      }
    });

    const settled = await Promise.allSettled(sendTasks);

    let sent = 0;
    let failed = 0;
    const errorMessages: string[] = [];

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        sent += 1;
      } else {
        failed += 1;
        errorMessages.push(
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason)
        );
      }
    }

    res.status(200).json({
      sent,
      failed,
      ...(errorMessages.length > 0 ? { errors: errorMessages } : {}),
    });
  } catch (error) {
    next(error);
  }
};
