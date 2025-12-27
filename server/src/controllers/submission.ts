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
import {
  generateInterviewQuestions as generateQuestionsFromCode,
  generateInterviewQuestionsFromRetrieval,
} from "../services/interviewGeneration.js";
import { indexSubmissionRepo } from "../services/repoIndexing.js";
import { searchCodeChunks } from "../services/repoRetrieval.js";
import RepoIndexModel from "../models/repoIndex.js";

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

    const submission = await SubmissionModel.findOne({ token }).populate(
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

    // Get all submissions for this assessment
    const submissions = await SubmissionModel.find({ assessmentId }).sort({
      submittedAt: -1,
      createdAt: -1,
    });

    res.status(200).json(submissions);
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

    // Generate interview questions using Pinecone retrieval
    let validatedQuestions;
    let retrievedChunkCount: number = 0;
    let chunkPaths: string[] = [];

    try {
      console.log(
        "🔄 [generateInterviewQuestionsByToken] Starting interview question generation with retrieval..."
      );
      const result = await generateInterviewQuestionsFromRetrieval(
        submission._id.toString(),
        assessment.description,
        assessment.scoring // Pass scoring map as rubric
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

    // Generate interview questions using Pinecone retrieval
    let validatedQuestions;
    let retrievedChunkCount: number = 0;
    let chunkPaths: string[] = [];

    try {
      console.log(
        "🔄 [generateInterviewQuestions] Starting interview question generation with retrieval..."
      );
      const result = await generateInterviewQuestionsFromRetrieval(
        submissionId,
        assessment.description,
        assessment.scoring // Pass scoring map as rubric
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

    // Build the prompt string
    const roleInstruction =
      "You are a technical interviewer conducting a live verbal interview.";

    const rules = `Rules:
- Ask the questions in order
- Do not invent new base questions
- You may ask brief follow-up questions if needed
- Keep the interview focused and technical
- If unsure about something, ask for clarification rather than guessing`;

    // Extract question prompts and format as numbered list
    const questionsList = submission.interviewQuestions
      .map((q, index) => `${index + 1}. ${q.prompt}`)
      .join("\n");

    // Combine into final prompt
    const prompt = `${roleInstruction}

${rules}

Interview Questions:
${questionsList}`;

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
