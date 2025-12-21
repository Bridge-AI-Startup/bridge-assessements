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
import { generateInterviewQuestions as generateQuestionsFromCode } from "../services/interviewGeneration.js";

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

    const { owner, repo, pinnedCommitSha } = submission.githubRepo;
    const assessment = submission.assessmentId as any;

    // Download and extract repository
    let snapshot;
    try {
      console.log(
        `📥 Downloading repo: ${owner}/${repo}@${pinnedCommitSha.substring(
          0,
          7
        )}`
      );
      snapshot = await downloadAndExtractRepoSnapshot({
        owner,
        repo,
        pinnedCommitSha,
        submissionId: submission._id.toString(),
      });
      console.log(`✅ Repository extracted to: ${snapshot.repoRootPath}`);
    } catch (error) {
      console.error("Failed to download/extract repository:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to download repository",
      });
    }

    // Generate interview questions
    let questions: string[];
    try {
      questions = await generateQuestionsFromCode(
        snapshot.repoRootPath,
        assessment.description || ""
      );
    } catch (error) {
      // Clean up on error
      try {
        await cleanupRepoSnapshot({
          zipPath: snapshot.zipPath,
          extractDir: snapshot.extractDir,
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup on generation error:", cleanupError);
      }

      console.error("Failed to generate interview questions:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate interview questions",
      });
    }

    // Clean up temp files
    try {
      await cleanupRepoSnapshot({
        zipPath: snapshot.zipPath,
        extractDir: snapshot.extractDir,
      });
      console.log("✅ Cleaned up temporary files");
    } catch (cleanupError) {
      console.warn("Failed to cleanup temp files:", cleanupError);
      // Don't fail the request if cleanup fails
    }

    res.status(200).json({
      questions,
      submissionId: submission._id.toString(),
      candidateName: submission.candidateName,
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

    const { owner, repo, pinnedCommitSha } = submission.githubRepo;

    // Download and extract repository
    let snapshot;
    try {
      console.log(
        `📥 Downloading repo: ${owner}/${repo}@${pinnedCommitSha.substring(
          0,
          7
        )}`
      );
      snapshot = await downloadAndExtractRepoSnapshot({
        owner,
        repo,
        pinnedCommitSha,
        submissionId: submissionId,
      });
      console.log(`✅ Repository extracted to: ${snapshot.repoRootPath}`);
    } catch (error) {
      console.error("Failed to download/extract repository:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to download repository",
      });
    }

    // Generate interview questions
    let questions: string[];
    try {
      questions = await generateQuestionsFromCode(
        snapshot.repoRootPath,
        assessment.description || ""
      );
    } catch (error) {
      // Clean up on error
      try {
        await cleanupRepoSnapshot({
          zipPath: snapshot.zipPath,
          extractDir: snapshot.extractDir,
        });
      } catch (cleanupError) {
        console.error("Failed to cleanup on generation error:", cleanupError);
      }

      console.error("Failed to generate interview questions:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate interview questions",
      });
    }

    // Clean up temp files
    try {
      await cleanupRepoSnapshot({
        zipPath: snapshot.zipPath,
        extractDir: snapshot.extractDir,
      });
      console.log("✅ Cleaned up temporary files");
    } catch (cleanupError) {
      console.warn("Failed to cleanup temp files:", cleanupError);
      // Don't fail the request if cleanup fails
    }

    res.status(200).json({
      questions,
      submissionId: submission._id.toString(),
      candidateName: submission.candidateName,
    });
  } catch (error) {
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
