import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import RepoIndexModel from "../models/repoIndex.js";
import { deleteNamespace } from "../utils/pinecone.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import { validateStarterCodeFiles } from "../utils/starterCodeValidation.js";
import {
  generateAssessmentComponents,
  generateBehavioralChecks,
} from "../services/assessmentGeneration.js";
import {
  AssessmentChatError,
  processAssessmentChat,
  type ChatTurn,
} from "../services/assessmentChat.js";
import { groundCriterion } from "../services/evaluation/grounder.js";
import {
  parseBehavioralCheckSpecs,
  type BehavioralCheckSpec,
} from "../services/behavioralGrading/checkSpecs.js";
import { shouldEnforceFreeTierAssessmentLimit } from "../utils/subscription.js";
import { isEvidenceMode } from "../utils/evidenceMode.js";

export type GenerateRequest = {
  description: string;
  stack?: string;
  level?: string;
  uid: string; // Added by verifyAuthToken middleware
};

export type GenerateResponse = {
  title: string;
  description: string;
  timeLimit: number;
  behavioralChecks: string[];
  /** Machine-checkable acceptance for the subset of checks the description pinned. */
  behavioralCheckSpecs: BehavioralCheckSpec[];
  starterCodeFiles: Array<{ path: string; content: string }>;
};

export type CreateRequest = {
  title: string;
  description: string;
  timeLimit: number;
  starterFilesGitHubLink?: string;
  starterCodeFiles?: Array<{ path: string; content: string }>;
  behavioralChecks?: string[];
  behavioralCheckSpecs?: unknown;
  evaluationCriteria?: string[];
  uid: string; // Added by verifyAuthToken middleware
};

export type UpdateRequest = {
  title?: string;
  description?: string;
  timeLimit?: number;
  starterFilesGitHubLink?: string;
  starterCodeFiles?: Array<{ path: string; content: string }>;
  evidenceMode?: "none" | "workflow" | "both" | "screen";
  behavioralChecks?: string[];
  behavioralCheckSpecs?: unknown;
  evaluationCriteria?: string[];
  pinned?: boolean;
  uid: string; // Added by verifyAuthToken middleware
};

/**
 * Keep stored specs tied to the sentences they verify.
 *
 * A spec whose `text` is no longer among the assessment's behavioral checks
 * grades nothing (`resolveBehavioralCheckSpecs` ignores it), so dropping it on
 * write stops orphans accumulating behind an edited check. When the caller is not
 * touching the check list, `checks` is undefined and everything valid is kept.
 */
function normalizeCheckSpecs(
  raw: unknown,
  checks: string[] | undefined
): BehavioralCheckSpec[] {
  const { specs } = parseBehavioralCheckSpecs(raw);
  if (!checks) return specs;
  const wanted = new Set(checks.map((c) => c.trim()));
  return specs.filter((s) => wanted.has(s.text.trim()));
}

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
      starterFilesGitHubLink,
      starterCodeFiles,
      behavioralChecks,
      behavioralCheckSpecs,
      evaluationCriteria,
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
    const subscriptionStatus =
      user.subscriptionStatus || (user as any).subscription?.subscriptionStatus;
    const isSubscribed = subscriptionStatus === "active";

    if (!isSubscribed && shouldEnforceFreeTierAssessmentLimit()) {
      // Count existing assessments for this user
      const assessmentCount = await AssessmentModel.countDocuments({ userId });

      // Free tier limit: 1 assessment (production only)
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

    const starterValidation = validateStarterCodeFiles(starterCodeFiles);
    if (!starterValidation.valid) {
      return res.status(400).json({ error: starterValidation.error });
    }

    const assessmentData: {
      userId: string;
      title: string;
      description: string;
      timeLimit: number;
      starterFilesGitHubLink?: string;
      starterCodeFiles?: Array<{ path: string; content: string }>;
      behavioralChecks?: string[];
      behavioralCheckSpecs?: unknown;
      evaluationCriteria?: string[];
    } = {
      userId,
      title,
      description,
      timeLimit,
    };

    // Only include starterFilesGitHubLink if provided
    if (starterFilesGitHubLink !== undefined) {
      assessmentData.starterFilesGitHubLink = starterFilesGitHubLink;
    }

    if (starterValidation.normalized && starterValidation.normalized.length > 0) {
      assessmentData.starterCodeFiles = starterValidation.normalized;
    }

    // Only include behavioralChecks if provided (array of strings)
    if (
      behavioralChecks !== undefined &&
      Array.isArray(behavioralChecks) &&
      behavioralChecks.length > 0
    ) {
      assessmentData.behavioralChecks = behavioralChecks.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0
      );
    }

    const createSpecs = normalizeCheckSpecs(
      behavioralCheckSpecs,
      assessmentData.behavioralChecks
    );
    if (createSpecs.length > 0) {
      assessmentData.behavioralCheckSpecs = createSpecs;
    }

    // Only include evaluationCriteria if provided (array of strings)
    if (
      evaluationCriteria !== undefined &&
      Array.isArray(evaluationCriteria) &&
      evaluationCriteria.length > 0
    ) {
      assessmentData.evaluationCriteria = evaluationCriteria.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0
      );
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

    // Pinned first (most recently pinned on top), then newest created.
    const assessments = await AssessmentModel.find({ userId }).sort({
      pinned: -1,
      pinnedAt: -1,
      createdAt: -1,
    });

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
      starterFilesGitHubLink,
      starterCodeFiles,
      evidenceMode,
      behavioralChecks,
      behavioralCheckSpecs,
      evaluationCriteria,
      pinned,
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
    if (starterFilesGitHubLink !== undefined) {
      (assessment as any).starterFilesGitHubLink = starterFilesGitHubLink;
    }
    if (starterCodeFiles !== undefined) {
      const starterValidation = validateStarterCodeFiles(starterCodeFiles);
      if (!starterValidation.valid) {
        return res.status(400).json({ error: starterValidation.error });
      }
      (assessment as any).starterCodeFiles =
        starterValidation.normalized ?? [];
    }
    if (evidenceMode !== undefined) {
      if (!isEvidenceMode(evidenceMode)) {
        return res.status(400).json({
          error: "evidenceMode must be 'none', 'workflow', 'both', or 'screen'",
        });
      }
      (assessment as any).evidenceMode = evidenceMode;
    }
    if (behavioralChecks !== undefined) {
      const checks = Array.isArray(behavioralChecks)
        ? behavioralChecks.filter(
            (c): c is string => typeof c === "string" && c.trim().length > 0
          )
        : [];
      (assessment as any).behavioralChecks = checks;
    }
    if (behavioralCheckSpecs !== undefined) {
      // Prune against the *resulting* check list, so editing a sentence and its
      // spec in one request keeps the spec instead of orphaning it.
      const liveChecks: string[] = Array.isArray(
        (assessment as any).behavioralChecks
      )
        ? (assessment as any).behavioralChecks
        : [];
      const specs = normalizeCheckSpecs(behavioralCheckSpecs, liveChecks);
      (assessment as any).behavioralCheckSpecs =
        specs.length > 0 ? specs : undefined;
      assessment.markModified("behavioralCheckSpecs");
    }
    if (evaluationCriteria !== undefined) {
      const criteria = Array.isArray(evaluationCriteria)
        ? evaluationCriteria.filter(
            (c): c is string => typeof c === "string" && c.trim().length > 0
          )
        : [];
      (assessment as any).evaluationCriteria = criteria;

      // Ground criteria when list is saved so evaluation can skip grounding per submission
      if (criteria.length > 0) {
        try {
          const groundings = await Promise.all(
            criteria.map((c) => groundCriterion(c))
          );
          (assessment as any).evaluationCriteriaGroundings = groundings;
        } catch (groundErr) {
          console.error(
            "[updateAssessment] Failed to ground evaluation criteria:",
            groundErr
          );
          // Leave evaluationCriteriaGroundings undefined so orchestrator falls back to per-submission grounding
        }
      } else {
        (assessment as any).evaluationCriteriaGroundings = undefined;
      }
    }
    if (pinned !== undefined) {
      (assessment as any).pinned = Boolean(pinned);
      (assessment as any).pinnedAt = pinned ? new Date() : null;
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
    const { description, stack, level } = req.body as GenerateRequest;
    const { uid } = req.body as { uid: string };

    // Check subscription limits BEFORE generating (to avoid wasting AI credits)
    if (uid) {
      // Get MongoDB user ID from Firebase UID
      const userId = await getUserIdFromFirebaseUid(uid);

      // Get user to check subscription tier
      const UserModel = (await import("../models/user.js")).default;
      const user = await UserModel.findById(userId);
      if (user) {
        // Check subscription limits - use subscriptionStatus === "active" as source of truth
        const subscriptionStatus =
          user.subscriptionStatus ||
          (user as any).subscription?.subscriptionStatus;
        const isSubscribed = subscriptionStatus === "active";

        if (!isSubscribed && shouldEnforceFreeTierAssessmentLimit()) {
          // Count existing assessments for this user
          const assessmentCount = await AssessmentModel.countDocuments({
            userId,
          });

          // Free tier limit: 1 assessment (production only)
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
      }
    }

    console.log(
      "🔄 [generateAssessmentData] Generating assessment data for description:",
      description.substring(0, 50) + "..."
    );

    // Generate all components via two-step chain (extract requirements → generate assessment)
    const options =
      stack != null || level != null
        ? {
            ...(stack != null && { stack: stack as "frontend-react" | "frontend-vue" | "backend-node" | "backend-python" | "mobile-react-native" | "fullstack" | "generic" }),
            ...(level != null && { level: level as "junior" | "mid" | "senior" }),
          }
        : undefined;
    const {
      title,
      description: generatedDescription,
      timeLimit,
      behavioralChecks,
      behavioralCheckSpecs,
      starterCodeFiles,
    } = await generateAssessmentComponents(description, options);

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
      behavioralChecks,
      behavioralCheckSpecs,
      starterCodeFiles,
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

export type GenerateBehavioralChecksRequest = {
  title: string;
  description: string;
  uid: string;
};

/**
 * Generate behavioral checks from title + description (manual assessment creation path).
 */
export const generateBehavioralChecksData: RequestHandler = async (
  req,
  res,
  next
) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { title, description } = req.body as GenerateBehavioralChecksRequest;
    const { uid } = req.body as { uid: string };

    if (uid) {
      const userId = await getUserIdFromFirebaseUid(uid);
      const UserModel = (await import("../models/user.js")).default;
      const user = await UserModel.findById(userId);
      if (user) {
        const subscriptionStatus =
          user.subscriptionStatus ||
          (user as any).subscription?.subscriptionStatus;
        const isSubscribed = subscriptionStatus === "active";

        if (!isSubscribed && shouldEnforceFreeTierAssessmentLimit()) {
          const assessmentCount = await AssessmentModel.countDocuments({
            userId,
          });
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
      }
    }

    const requirementsSummary =
      description.length > 2000 ? description.slice(0, 2000) : description;
    const { checks: behavioralChecks, specs: behavioralCheckSpecs } =
      await generateBehavioralChecks({
        title: title.trim(),
        description,
        requirementsSummary,
      });

    res.status(200).json({ behavioralChecks, behavioralCheckSpecs });
  } catch (error) {
    console.error("❌ [generateBehavioralChecksData] Error:", error);
    next(error);
  }
};

export type ChatRequest = {
  message: string;
  allowedSections?: string[];
  /** Prior turns of this conversation, oldest first. */
  history?: ChatTurn[];
  uid: string; // Added by verifyAuthToken middleware
};

/**
 * Chat endpoint for interacting with assessment
 * Allows users to modify assessment through natural language
 *
 * This route is the single writer for the changes it makes: it persists them and
 * returns the saved assessment. The editor renders what comes back rather than
 * re-saving, which is what stopped a stale client copy from overwriting the
 * title the model had just changed.
 */
export const chatWithAssessment: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message, allowedSections, history, uid } = req.body as ChatRequest;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    console.log("💬 [chatWithAssessment] Chat request:", {
      assessmentId: id,
      message: message.substring(0, 50) + "...",
      allowedSections,
      historyTurns: Array.isArray(history) ? history.length : 0,
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

    const currentChecks: string[] = Array.isArray(
      (assessment as any).behavioralChecks
    )
      ? (assessment as any).behavioralChecks.filter(
          (c: unknown): c is string => typeof c === "string"
        )
      : [];
    const currentCriteria: string[] = Array.isArray(
      (assessment as any).evaluationCriteria
    )
      ? (assessment as any).evaluationCriteria.filter(
          (c: unknown): c is string => typeof c === "string"
        )
      : [];

    // Process chat message
    const chatResponse = await processAssessmentChat({
      message: message.trim(),
      assessmentContext: {
        title: assessment.title,
        description: assessment.description,
        timeLimit: assessment.timeLimit,
        behavioralChecks: currentChecks,
        evaluationCriteria: currentCriteria,
      },
      allowedSections: allowedSections || [],
      history: Array.isArray(history) ? history : [],
    });

    const { updates } = chatResponse;
    let dirty = false;

    if (updates.title !== undefined) {
      assessment.title = updates.title;
      dirty = true;
    }
    if (updates.description !== undefined) {
      assessment.description = updates.description;
      dirty = true;
    }
    if (updates.timeLimit !== undefined) {
      assessment.timeLimit = updates.timeLimit;
      dirty = true;
    }
    if (updates.behavioralChecks !== undefined) {
      (assessment as any).behavioralChecks = updates.behavioralChecks;
      // Specs are keyed to check text, so rewriting the list orphans the specs
      // whose sentence no longer exists. Prune to what survived.
      const existingSpecs = (assessment as any).behavioralCheckSpecs;
      if (Array.isArray(existingSpecs) && existingSpecs.length > 0) {
        const specs = normalizeCheckSpecs(
          existingSpecs,
          updates.behavioralChecks
        );
        (assessment as any).behavioralCheckSpecs =
          specs.length > 0 ? specs : undefined;
        assessment.markModified("behavioralCheckSpecs");
      }
      dirty = true;
    }
    if (updates.evaluationCriteria !== undefined) {
      (assessment as any).evaluationCriteria = updates.evaluationCriteria;
      // Mirror updateAssessment: pre-ground so evaluation can skip per-submission
      // grounding, and fall back silently rather than failing the chat turn.
      if (updates.evaluationCriteria.length > 0) {
        try {
          (assessment as any).evaluationCriteriaGroundings = await Promise.all(
            updates.evaluationCriteria.map((c) => groundCriterion(c))
          );
        } catch (groundErr) {
          console.error(
            "[chatWithAssessment] Failed to ground evaluation criteria:",
            groundErr
          );
          (assessment as any).evaluationCriteriaGroundings = undefined;
        }
      } else {
        (assessment as any).evaluationCriteriaGroundings = undefined;
      }
      dirty = true;
    }

    if (dirty) {
      await assessment.save();
      console.log(
        "💾 [chatWithAssessment] Saved sections:",
        chatResponse.changedSections
      );
    }

    res.status(200).json({
      updates: chatResponse.updates,
      changedSections: chatResponse.changedSections,
      changesSummary: chatResponse.changesSummary,
      responseMessage: chatResponse.responseMessage,
      model: chatResponse.model,
      provider: chatResponse.provider,
      // Authoritative post-save state — the editor renders this directly.
      assessment: assessment.toObject(),
    });
  } catch (error) {
    if (error instanceof AssessmentChatError) {
      // A usable explanation, not "Unknown Error. Try Again".
      console.error("❌ [chatWithAssessment]", error.message);
      return res.status(502).json({ error: error.message });
    }
    console.error("❌ [chatWithAssessment] Error:", error);
    next(error);
  }
};
