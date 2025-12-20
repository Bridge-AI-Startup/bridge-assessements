import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
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
  scoring: Record<string, number>;
};

export type CreateRequest = {
  title: string;
  description: string;
  timeLimit: number;
  scoring?: Record<string, number>; // Key-value pair: category -> percent weight
  uid: string; // Added by verifyAuthToken middleware
};

export type UpdateRequest = {
  title?: string;
  description?: string;
  timeLimit?: number;
  scoring?: Record<string, number>; // Key-value pair: category -> percent weight
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
    const { title, description, timeLimit, scoring, uid } =
      req.body as CreateRequest;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    const assessmentData: {
      userId: string;
      title: string;
      description: string;
      timeLimit: number;
      scoring?: Map<string, number>;
    } = {
      userId,
      title,
      description,
      timeLimit,
    };

    // Convert scoring object to Map if provided
    if (scoring) {
      assessmentData.scoring = new Map(Object.entries(scoring));
    }

    const newAssessment = await AssessmentModel.create(assessmentData);

    // Convert Map to object for JSON response
    const assessmentResponse = newAssessment.toObject();
    if (assessmentResponse.scoring instanceof Map) {
      assessmentResponse.scoring = Object.fromEntries(
        assessmentResponse.scoring
      );
    }

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

    // Convert Maps to objects for JSON response
    const assessmentsResponse = assessments.map((assessment) => {
      const assessmentObj = assessment.toObject();
      if (assessmentObj.scoring instanceof Map) {
        assessmentObj.scoring = Object.fromEntries(assessmentObj.scoring);
      }
      return assessmentObj;
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
    const { title, description, timeLimit, scoring, uid } =
      req.body as UpdateRequest;
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
    if (scoring !== undefined && scoring !== null) {
      // Convert scoring object to Map
      assessment.scoring = new Map(Object.entries(scoring));
    }

    await assessment.save();

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
 * Delete an assessment (only if it belongs to the user)
 */
export const deleteAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };
    const { id } = req.params;

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);

    const assessment = await AssessmentModel.findOneAndDelete({
      _id: id,
      userId,
    });

    if (!assessment) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    res.status(200).json({ message: "Assessment deleted successfully" });
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
      scoring,
    } = await generateAssessmentComponents(description);

    console.log("🔍 [generateAssessmentData] Generated components:", {
      title,
      description: generatedDescription?.substring(0, 100) + "...",
      descriptionLength: generatedDescription?.length,
      timeLimit,
      hasScoring: !!scoring,
      scoringKeys: scoring ? Object.keys(scoring) : [],
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
      scoring,
    };

    console.log("✅ [generateAssessmentData] Sending response:", {
      title: response.title,
      description: response.description?.substring(0, 100) + "...",
      descriptionLength: response.description?.length,
      timeLimit: response.timeLimit,
      scoringKeys: Object.keys(response.scoring),
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
  rubric?: Array<{ criteria: string; weight: string }>;
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
    const { message, allowedSections, rubric, testCases, uid } =
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

    // Convert Map to object for context
    const scoringObj =
      assessment.scoring instanceof Map
        ? Object.fromEntries(assessment.scoring)
        : assessment.scoring || {};

    // Build assessment context
    const assessmentContext = {
      title: assessment.title,
      description: assessment.description,
      timeLimit: assessment.timeLimit,
      scoring: scoringObj,
      rubric: rubric || [],
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
      scoring?: Map<string, number>;
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
    if (chatResponse.updates.scoring) {
      updates.scoring = new Map(Object.entries(chatResponse.updates.scoring));
    }

    // Update assessment if there are database updates
    if (Object.keys(updates).length > 0) {
      Object.assign(assessment, updates);
      await assessment.save();
      console.log("💾 [chatWithAssessment] Assessment updated in database");
    }

    // Convert updated assessment Map to object for response
    const assessmentResponse = assessment.toObject();
    if (assessmentResponse.scoring instanceof Map) {
      assessmentResponse.scoring = Object.fromEntries(
        assessmentResponse.scoring
      );
    }

    // Return response with updates and frontend-only fields
    res.status(200).json({
      updates: {
        ...chatResponse.updates,
        // Include frontend-only fields
        rubric: chatResponse.updates.rubric,
        testCases: chatResponse.updates.testCases,
      },
      changedSections: chatResponse.changedSections,
      changesSummary: chatResponse.changesSummary,
      responseMessage: chatResponse.responseMessage,
      // Return updated assessment data
      assessment: assessmentResponse,
    });
  } catch (error) {
    console.error("❌ [chatWithAssessment] Error:", error);
    next(error);
  }
};
