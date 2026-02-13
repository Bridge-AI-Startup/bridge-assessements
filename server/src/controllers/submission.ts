import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import validationErrorParser from "../util/validationErrorParser.js";
import { parseGithubRepoUrl, resolvePinnedCommit } from "../util/github.js";
import {
  downloadAndExtractRepoSnapshot,
  cleanupRepoSnapshot,
} from "../util/repoSnapshot.js";
import { generateInterviewQuestionsFromRetrieval } from "../services/interviewGeneration.js";
import { indexSubmissionRepo } from "../services/repoIndexing.js";
import { searchCodeChunks } from "../services/repoRetrieval.js";
import RepoIndexModel from "../models/repoIndex.js";
import { deleteNamespace } from "../util/pinecone.js";
import { PROMPT_INTERVIEW_AGENT } from "../prompts/index.js";
import { uploadLLMTrace, parseTraceFile } from "../util/fileUpload.js";
import { logLLMEvent } from "../services/llmProxy/logger.js";
import { executeAllTasks } from "../services/taskRunner/taskRunner.js";

export type StartSubmissionRequest = {
  assessmentId: string;
  candidateName?: string;
  candidateEmail?: string;
};

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
 * Start a new submission (public endpoint - no auth required)
 * @deprecated - Use startAssessment with token instead
 */
export const startSubmission: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { assessmentId, candidateName, candidateEmail } =
      req.body as StartSubmissionRequest;

    // Verify assessment exists
    const assessment = await AssessmentModel.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: "Assessment not found" });
    }

    // Create new submission
    const submissionData: {
      assessmentId: string;
      candidateName?: string;
      candidateEmail?: string;
      status: string;
      startedAt: Date;
      metadata?: {
        ipAddress?: string;
        userAgent?: string;
      };
    } = {
      assessmentId,
      status: "in-progress",
      startedAt: new Date(),
    };

    if (candidateName) {
      submissionData.candidateName = candidateName;
    }
    if (candidateEmail) {
      submissionData.candidateEmail = candidateEmail;
    }

    // Add metadata if available
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get("user-agent");
    if (ipAddress || userAgent) {
      submissionData.metadata = {};
      if (ipAddress) {
        submissionData.metadata.ipAddress = ipAddress;
      }
      if (userAgent) {
        submissionData.metadata.userAgent = userAgent;
      }
    }

    const newSubmission = await SubmissionModel.create(submissionData);

    res.status(201).json(newSubmission);
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
      select: "title description timeLimit starterFilesGitHubLink isSmartInterviewerEnabled",
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
        timeRemaining = Math.floor(remaining); // Round down to whole minutes
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
        timeRemaining = Math.floor(remaining); // Round down to whole minutes
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
    if (assessment && assessment.timeLimit && submission.startedAt) {
      const elapsedMinutes =
        (Date.now() - new Date(submission.startedAt).getTime()) / (1000 * 60);
      if (elapsedMinutes > assessment.timeLimit) {
        // Time exceeded - mark as expired but still allow submission
        submission.status = "expired";
      }
      submission.timeSpent = Math.floor(elapsedMinutes);
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
    if (assessment && assessment.timeLimit) {
      const timeElapsed = timeSpent || submission.timeSpent;
      if (timeElapsed > assessment.timeLimit) {
        // Still allow submission but mark as expired
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
    submission.status = "submitted";
    submission.submittedAt = new Date();

    await submission.save();

    const updatedSubmission = await SubmissionModel.findById(id).populate(
      "assessmentId",
      "title description timeLimit"
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

    res.status(200).json(submissions);
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

    // Verify GitHub repo info exists
    if (
      !submission.githubRepo ||
      !submission.githubRepo.owner ||
      !submission.githubRepo.repo ||
      !submission.githubRepo.pinnedCommitSha
    ) {
      return res.status(400).json({
        error: "GitHub repository information not found for this submission",
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

    // Check if smart interviewer is enabled
    const isSmartInterviewerEnabled = (assessment as any).isSmartInterviewerEnabled !== false; // Default to true if not set
    
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

    // Verify GitHub repo info exists
    if (
      !submission.githubRepo ||
      !submission.githubRepo.owner ||
      !submission.githubRepo.repo ||
      !submission.githubRepo.pinnedCommitSha
    ) {
      return res.status(400).json({
        error: "GitHub repository information not found for this submission",
      });
    }

    // Validate assessment description exists
    if (!assessment.description || !assessment.description.trim()) {
      return res.status(400).json({
        error:
          "Assessment description is required to generate interview questions",
      });
    }

    // Check if smart interviewer is enabled
    const isSmartInterviewerEnabled = (assessment as any).isSmartInterviewerEnabled !== false; // Default to true if not set
    
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

    const pinnedCommitSha = submission.githubRepo?.pinnedCommitSha;

    if (!pinnedCommitSha) {
      return res.status(400).json({
        error: "GitHub repository information not found for this submission",
      });
    }

    const repoIndex = await RepoIndexModel.findOne({
      submissionId: submission._id,
      pinnedCommitSha,
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
    const { assessmentId, candidateName, uid } =
      req.body as GenerateShareLinkRequest;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Get user to check subscription tier
    const UserModel = (await import("../models/user.js")).default;
    const user = await UserModel.findById(userId);
    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Check subscription limits - use subscriptionStatus === "active" as source of truth
    const subscriptionStatus = user.subscriptionStatus || (user as any).subscription?.subscriptionStatus;
    const isSubscribed = subscriptionStatus === "active";
    
    if (!isSubscribed) {
      // Count total submissions across all assessments for this user
      const userAssessments = await AssessmentModel.find({ userId });
      const assessmentIds = userAssessments.map((a) => a._id);
      const submissionCount = await SubmissionModel.countDocuments({
        assessmentId: { $in: assessmentIds },
      });

      // Free tier limit: 3 submissions total
      if (submissionCount >= 3) {
        return res.status(403).json({
          error: "SUBSCRIPTION_LIMIT_REACHED",
          message:
            "You've reached the free tier limit of 3 candidate submissions. Upgrade to continue.",
          limit: 3,
          current: submissionCount,
        });
      }
    }

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
      status: "pending",
      // startedAt will be null until candidate starts
    });

    // Generate shareable link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const shareLink = `${frontendUrl}/CandidateAssessment?token=${submission.token}`;

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
 * Normalize trace JSON into an array of events.
 * Accepts: { events: [] }, root array [], or { messages: [] } / { conversations: [] } / { turns: [] }.
 */
function normalizeTraceEvents(traceData: unknown): unknown[] | null {
  if (Array.isArray(traceData)) return traceData;
  if (!traceData || typeof traceData !== "object") return null;
  const obj = traceData as Record<string, unknown>;
  if (Array.isArray(obj.events)) return obj.events;
  // Nested: { trace: { events: [] } } or { data: { events: [] } }
  const nested = (obj.trace || obj.data) as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object" && Array.isArray(nested.events))
    return nested.events;
  if (Array.isArray(obj.messages))
    return obj.messages.map((m: any) => ({
      type: "llm_call",
      timestamp: m.timestamp || new Date().toISOString(),
      model: m.model,
      provider: m.provider,
      prompt: m.prompt ?? m.content ?? (m.role === "user" ? m.content : ""),
      response: m.response ?? m.content ?? (m.role === "assistant" ? m.content : ""),
      tokens: m.tokens ?? { input: 0, output: 0, total: 0 },
      latency: m.latency,
      cost: m.cost,
      metadata: m.metadata ?? {},
    }));
  if (Array.isArray(obj.conversations)) {
    const events: any[] = [];
    for (const conv of obj.conversations) {
      if (Array.isArray(conv.messages))
        events.push(
          ...conv.messages.map((m: any) => ({
            type: "llm_call",
            timestamp: m.timestamp || conv.timestamp || new Date().toISOString(),
            model: conv.model || m.model,
            provider: conv.provider || m.provider,
            prompt: m.prompt ?? m.content ?? (m.role === "user" ? m.content : ""),
            response: m.response ?? m.content ?? (m.role === "assistant" ? m.content : ""),
            tokens: m.tokens ?? conv.tokens ?? { input: 0, output: 0, total: 0 },
            latency: m.latency ?? conv.latency,
            cost: m.cost ?? conv.cost,
            metadata: m.metadata ?? conv.metadata ?? {},
          }))
        );
    }
    return events.length ? events : null;
  }
  if (Array.isArray(obj.turns))
    return obj.turns.map((t: any) => ({
      type: "llm_call",
      timestamp: t.timestamp || new Date().toISOString(),
      model: t.model,
      provider: t.provider,
      prompt: t.prompt ?? t.user_input ?? t.input ?? "",
      response: t.response ?? t.assistant_output ?? t.output ?? "",
      tokens: t.tokens ?? { input: 0, output: 0, total: 0 },
      latency: t.latency,
      cost: t.cost,
      metadata: t.metadata ?? {},
    }));
  if (Array.isArray(obj.conversation)) return obj.conversation;
  if (Array.isArray(obj.calls)) return obj.calls;
  return null;
}

/**
 * Upload LLM trace file
 * POST /api/submissions/token/:token/upload-trace
 * Public endpoint (candidate access)
 */
export const uploadLLMTraceByToken: RequestHandler = async (
  req,
  res,
  next
) => {
  uploadLLMTrace(req, res, async (err) => {
    if (err) {
      const message =
        err.message && err.message.includes("Unexpected end of form")
          ? "Upload failed: file may be empty or corrupted. Please choose a valid JSON trace file and try again."
          : err.message;
      return res.status(400).json({ error: message });
    }

    try {
      const { token } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "LLM trace file is required" });
      }

      const submission = await SubmissionModel.findOne({ token });
      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }

      if (submission.status !== "in-progress") {
        return res.status(400).json({
          error: "Can only upload trace during active assessment",
        });
      }

      // Parse trace file
      const traceData = parseTraceFile(file);

      // Normalize: accept { events }, root array, or { messages/conversations/turns }
      const events = normalizeTraceEvents(traceData);
      if (!Array.isArray(events)) {
        const received =
          traceData && typeof traceData === "object"
            ? Object.keys(traceData).join(", ") || "(empty object)"
            : typeof traceData;
        return res.status(400).json({
          error: `Invalid trace format: expected an object with "events" array (or a root array). Received keys: ${received}. Add an "events" array with your LLM call entries.`,
        });
      }

      // Generate or use existing session ID (top-level or under trace/data)
      const top = traceData as Record<string, unknown> | null;
      const nested = top?.trace || top?.data;
      const rawSessionId =
        typeof top?.sessionId === "string"
          ? top.sessionId
          : nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).sessionId === "string"
            ? (nested as Record<string, unknown>).sessionId
            : null;
      const sessionId =
        typeof rawSessionId === "string" && rawSessionId
          ? rawSessionId
          : `session_${submission._id}_${Date.now()}`;

      // Process and store trace events (normalize prompt/response from any common JSON keys)
      for (const event of events) {
        const e = event as any;
        const promptVal =
          e.prompt ??
          e.content ??
          e.input ??
          e.user_input ??
          e.userMessage ??
          e.user_message ??
          e.question ??
          e.humanMessage ??
          e.human ??
          e.text ??
          e.messages?.[0]?.content ??
          e.data?.prompt ??
          e.data?.input ??
          e.data?.content ??
          e.payload?.prompt ??
          e.payload?.input ??
          e.payload?.content ??
          (Array.isArray(e.messages) && e.messages[0]?.content != null
            ? (typeof e.messages[0].content === "string"
                ? e.messages[0].content
                : JSON.stringify(e.messages[0].content))
            : undefined);
        const responseVal =
          e.response ??
          e.output ??
          e.assistant_output ??
          e.assistantMessage ??
          e.assistant_message ??
          e.answer ??
          e.aiMessage ??
          e.ai ??
          e.completion ??
          (e.role === "assistant" ? e.content : undefined) ??
          e.messages?.[1]?.content ??
          (e.response && typeof e.response === "object" && "content" in e.response
            ? e.response.content
            : undefined) ??
          e.data?.response ??
          e.data?.output ??
          e.data?.content ??
          e.payload?.response ??
          e.payload?.output ??
          e.payload?.content ??
          (Array.isArray(e.messages) && e.messages[1]?.content != null
            ? (typeof e.messages[1].content === "string"
                ? e.messages[1].content
                : JSON.stringify(e.messages[1].content))
            : undefined);
        await logLLMEvent({
          submissionId: submission._id.toString(),
          sessionId,
          type: e.type || "llm_call",
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
          model: e.model,
          provider: e.provider,
          prompt:
            promptVal != null
              ? typeof promptVal === "string"
                ? promptVal
                : JSON.stringify(promptVal)
              : undefined,
          response: responseVal,
          tokens: e.tokens,
          latency: e.latency,
          cost: e.cost,
          metadata: e.metadata,
        });
      }

      // Update evaluation metadata
      if (!submission.llmWorkflow) {
        submission.llmWorkflow = {
          trace: {
            sessionId,
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

      submission.llmWorkflow.evaluation.startedAt =
        submission.llmWorkflow.evaluation.startedAt || new Date();
      await submission.save();

      res.json({
        message: "Trace uploaded successfully",
        eventsProcessed: events.length,
        sessionId,
      });
    } catch (error) {
      next(error);
    }
  });
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
    await submission.save();

    res.json(scores);
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate full scores (completeness + workflow) for a submission
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
