import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import RepoIndexModel from "../models/repoIndex.js";
import { deleteNamespace } from "../util/pinecone.js";
import validationErrorParser from "../util/validationErrorParser.js";
import { generateAssessmentComponents } from "../services/openai.js";
import { processAssessmentChat } from "../services/assessmentChat.js";

export type GenerateRequest = {
  description: string;
  uid: string; // Added by verifyAuthToken middleware
};

export type GenerateResponse = {
  title: string;
  description: string;
  timeLimit: number;
};

export type CreateRequest = {
  title: string;
  description: string;
  timeLimit: number;
  numInterviewQuestions?: number;
  starterFilesGitHubLink?: string;
  interviewerCustomInstructions?: string;
  uid: string; // Added by verifyAuthToken middleware
};

export type UpdateRequest = {
  title?: string;
  description?: string;
  timeLimit?: number;
  numInterviewQuestions?: number;
  starterFilesGitHubLink?: string;
  interviewerCustomInstructions?: string;
  isSmartInterviewerEnabled?: boolean;
  uid: string; // Added by verifyAuthToken middleware
};

// Helper function to get user ID from Firebase UID
async function getUserIdFromFirebaseUid(firebaseUid: string): Promise<string> {
  const UserModel = (await import("../models/user.js")).default;
  const user = await UserModel.findOne({ firebaseUid });
  if (!user) {
    throw AuthError.INVALID_AUTH_TOKEN;
  }
  return user._id.toString();
}

/**
 * Create a new assessment
 */
export const createAssessment: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const {
      title,
      description,
      timeLimit,
      numInterviewQuestions,
      starterFilesGitHubLink,
      interviewerCustomInstructions,
      uid,
    } = req.body as CreateRequest;

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
      // Count existing assessments for this user
      const assessmentCount = await AssessmentModel.countDocuments({ userId });

      // Free tier limit: 1 assessment
      if (assessmentCount >= 1) {
        return res.status(403).json({
          error: "SUBSCRIPTION_LIMIT_REACHED",
          message:
            "You've reached the free tier limit of 1 assessment. Upgrade to create unlimited assessments.",
          limit: 1,
          current: assessmentCount,
        });
      }
    }

    const assessmentData: {
      userId: string;
      title: string;
      description: string;
      timeLimit: number;
      numInterviewQuestions?: number;
      starterFilesGitHubLink?: string;
      interviewerCustomInstructions?: string;
    } = {
      userId,
      title,
      description,
      timeLimit,
    };

    // Only include numInterviewQuestions if provided
    if (numInterviewQuestions !== undefined) {
      assessmentData.numInterviewQuestions = numInterviewQuestions;
    }

    // Only include starterFilesGitHubLink if provided
    if (starterFilesGitHubLink !== undefined) {
      assessmentData.starterFilesGitHubLink = starterFilesGitHubLink;
    }

    // Only include interviewerCustomInstructions if provided
    if (interviewerCustomInstructions !== undefined) {
      assessmentData.interviewerCustomInstructions =
        interviewerCustomInstructions;
    }

    const newAssessment = await AssessmentModel.create(assessmentData);

    // Convert to object for JSON response
    const assessmentResponse = newAssessment.toObject();

    res.status(201).json(assessmentResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all assessments for the current user
 */
export const getAssessments: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    const assessments = await AssessmentModel.find({ userId }).sort({
      createdAt: -1,
    }); // Most recent first

    // Convert to objects for JSON response
    const assessmentsResponse = assessments.map((assessment) => {
      return assessment.toObject();
    });

    res.status(200).json(assessmentsResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single assessment by ID (only if it belongs to the user)
 */
export const getAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };
    const { id } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    const assessment = await AssessmentModel.findOne({
      _id: id,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN; // Don't reveal if assessment exists but doesn't belong to user
    }

    // Convert Map to object for JSON response
    const assessmentResponse = assessment.toObject();
    if (assessmentResponse.scoring instanceof Map) {
      assessmentResponse.scoring = Object.fromEntries(
        assessmentResponse.scoring
      );
    }

    res.status(200).json(assessmentResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * Update an assessment (only if it belongs to the user)
 */
export const updateAssessment: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const {
      title,
      description,
      timeLimit,
      numInterviewQuestions,
      starterFilesGitHubLink,
      interviewerCustomInstructions,
      isSmartInterviewerEnabled,
      uid,
    } = req.body as UpdateRequest;
    const { id } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Find the assessment and verify ownership
    const assessment = await AssessmentModel.findOne({
      _id: id,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Update only provided fields
    if (title !== undefined) {
      assessment.title = title;
    }
    if (description !== undefined) {
      assessment.description = description;
    }
    if (timeLimit !== undefined) {
      assessment.timeLimit = timeLimit;
    }
    if (numInterviewQuestions !== undefined) {
      assessment.numInterviewQuestions = numInterviewQuestions;
    }
    if (starterFilesGitHubLink !== undefined) {
      (assessment as any).starterFilesGitHubLink = starterFilesGitHubLink;
    }
    if (interviewerCustomInstructions !== undefined) {
      (assessment as any).interviewerCustomInstructions =
        interviewerCustomInstructions;
    }
    if (isSmartInterviewerEnabled !== undefined) {
      (assessment as any).isSmartInterviewerEnabled = isSmartInterviewerEnabled;
    }

    await assessment.save();

    // Convert to object for JSON response
    const assessmentResponse = assessment.toObject();

    res.status(200).json(assessmentResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete an assessment (only if it belongs to the user)
 * Also deletes all associated submissions and their Pinecone data
 */
export const deleteAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };
    const { id } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // First verify the assessment exists and belongs to the user
    const assessment = await AssessmentModel.findOne({
      _id: id,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Find all submissions for this assessment
    const submissions = await SubmissionModel.find({ assessmentId: id });

    console.log(
      `🗑️ [deleteAssessment] Found ${submissions.length} submissions to delete for assessment ${id}`
    );

    // Delete each submission and its associated data
    for (const submission of submissions) {
      const submissionId = submission._id.toString();

      // Step 1: Find and delete Pinecone data if it exists
      const repoIndex = await RepoIndexModel.findOne({ submissionId });
      if (repoIndex && repoIndex.pinecone) {
        try {
          await deleteNamespace(
            repoIndex.pinecone.indexName,
            repoIndex.pinecone.namespace
          );
          console.log(
            `✅ [deleteAssessment] Deleted Pinecone namespace ${repoIndex.pinecone.namespace} for submission ${submissionId}`
          );
        } catch (pineconeError) {
          // Log error but don't fail the deletion - Pinecone cleanup is best effort
          console.error(
            `⚠️ [deleteAssessment] Failed to delete Pinecone namespace for submission ${submissionId}:`,
            pineconeError
          );
        }
      }

      // Step 2: Delete RepoIndex record from MongoDB
      if (repoIndex) {
        await RepoIndexModel.findByIdAndDelete(repoIndex._id);
        console.log(
          `✅ [deleteAssessment] Deleted RepoIndex record for submission ${submissionId}`
        );
      }

      // Step 3: Delete the submission from MongoDB
      await SubmissionModel.findByIdAndDelete(submissionId);
      console.log(`✅ [deleteAssessment] Deleted submission ${submissionId}`);
    }

    // Step 4: Finally, delete the assessment itself
    await AssessmentModel.findByIdAndDelete(id);

    console.log(
      `✅ [deleteAssessment] Successfully deleted assessment ${id} and ${submissions.length} associated submissions`
    );

    res.status(200).json({
      message: "Assessment deleted successfully",
      deletedSubmissions: submissions.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate assessment data from description
 * This endpoint uses OpenAI to generate title, timeLimit, and scoring based on the description
 */
export const generateAssessmentData: RequestHandler = async (
  req,
  res,
  next
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { description } = req.body as GenerateRequest;

    console.log(
      "🔄 [generateAssessmentData] Generating assessment data for description:",
      description.substring(0, 50) + "..."
    );

    // Generate all components using OpenAI
    const {
      title,
      description: generatedDescription,
      timeLimit,
    } = await generateAssessmentComponents(description);

    console.log("🔍 [generateAssessmentData] Generated components:", {
      title,
      description: generatedDescription?.substring(0, 100) + "...",
      descriptionLength: generatedDescription?.length,
      timeLimit,
    });

    if (!generatedDescription) {
      console.error(
        "❌ [generateAssessmentData] Missing description in generated components!"
      );
    }

    const response: GenerateResponse = {
      title,
      description: generatedDescription || description, // Fallback to input if missing
      timeLimit,
    };

    console.log("✅ [generateAssessmentData] Sending response:", {
      title: response.title,
      description: response.description?.substring(0, 100) + "...",
      descriptionLength: response.description?.length,
      timeLimit: response.timeLimit,
    });

    res.status(200).json(response);
  } catch (error) {
    console.error("❌ [generateAssessmentData] Error:", error);
    next(error);
  }
};

export type ChatRequest = {
  message: string;
  allowedSections?: string[];
  testCases?: Array<{ name: string; type: string; points: number }>;
  uid: string; // Added by verifyAuthToken middleware
};

/**
 * Chat endpoint for interacting with assessment
 * Allows users to modify assessment through natural language
 */
export const chatWithAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message, allowedSections, testCases, uid } =
      req.body as ChatRequest;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    console.log("💬 [chatWithAssessment] Chat request:", {
      assessmentId: id,
      message: message.substring(0, 50) + "...",
      allowedSections,
    });

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    // Find the assessment and verify ownership
    const assessment = await AssessmentModel.findOne({
      _id: id,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Build assessment context
    const assessmentContext = {
      title: assessment.title,
      description: assessment.description,
      timeLimit: assessment.timeLimit,
      testCases: testCases || [],
    };

    // Process chat message
    const chatResponse = await processAssessmentChat({
      message: message.trim(),
      assessmentContext,
      allowedSections: allowedSections || [],
    });

    // Apply updates to assessment
    const updates: {
      title?: string;
      description?: string;
      timeLimit?: number;
    } = {};

    if (chatResponse.updates.title) {
      updates.title = chatResponse.updates.title;
    }
    if (chatResponse.updates.description) {
      updates.description = chatResponse.updates.description;
    }
    if (chatResponse.updates.timeLimit !== undefined) {
      updates.timeLimit = chatResponse.updates.timeLimit;
    }

    // Update assessment if there are database updates
    if (Object.keys(updates).length > 0) {
      Object.assign(assessment, updates);
      await assessment.save();
      console.log("💾 [chatWithAssessment] Assessment updated in database");
    }

    // Convert updated assessment to object for response
    const assessmentResponse = assessment.toObject();

    // Return response with updates and frontend-only fields
    res.status(200).json({
      updates: {
        ...chatResponse.updates,
        // Include frontend-only fields
        testCases: chatResponse.updates.testCases,
      },
      changedSections: chatResponse.changedSections,
      changesSummary: chatResponse.changesSummary,
      responseMessage: chatResponse.responseMessage,
      model: chatResponse.model,
      provider: chatResponse.provider,
      // Return updated assessment data
      assessment: assessmentResponse,
    });
  } catch (error) {
    console.error("❌ [chatWithAssessment] Error:", error);
    next(error);
  }
};
