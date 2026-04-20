import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import UserModel from "../models/user.ts";
import { firebaseAdminAuth } from "../utils/firebase.js";
import validationErrorParser from "../utils/validationErrorParser.js";
import { getUserIdFromFirebaseUid } from "../utils/auth.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import RepoIndexModel from "../models/repoIndex.js";
import { deleteNamespace } from "../utils/pinecone.js";
import { stripe } from "../services/stripe.js";
import { shouldEnforceFreeTierAssessmentLimit } from "../utils/subscription.js";
import { getHackathonAdminEmail } from "../utils/hackathonAdmin.js";

export type CreateRequest = {
  companyName: string;
  companyLogoUrl?: string | null;
  uid: string; // Added by verifyAuthToken middleware
};

export type LoginRequest = {
  uid: string;
};

export const createUser: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { companyName, companyLogoUrl, uid } = req.body as CreateRequest;

    // Get Firebase user info to get email
    // The Firebase user was already created by the frontend
    const firebaseUser = await firebaseAdminAuth.getUser(uid);
    const email = firebaseUser.email;

    if (!email) {
      throw new Error("Firebase user does not have an email");
    }

    // email is guaranteed to be string here (not null) due to the check above
    const userEmail: string = email;

    // Check if user already exists in MongoDB
    const existingUser = await UserModel.findOne({ firebaseUid: uid });
    if (existingUser) {
      // Update existing user
      existingUser.companyName = companyName;
      if (companyLogoUrl !== undefined) {
        existingUser.companyLogoUrl = companyLogoUrl ? companyLogoUrl : null;
      }
      await existingUser.save();
      res.status(200).json(existingUser);
      return;
    }

    // Create new user in MongoDB
    const userData: {
      firebaseUid: string;
      companyName: string;
      email: string;
      companyLogoUrl?: string;
    } = {
      firebaseUid: uid,
      companyName,
      email: userEmail,
    };

    if (companyLogoUrl) {
      userData.companyLogoUrl = companyLogoUrl;
    }

    const newUser = await UserModel.create(userData);

    res.status(201).json(newUser);
  } catch (error) {
    next(error);
  }
};

export const loginUser: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { uid } = req.body as LoginRequest;
    const user = await UserModel.findOne({ firebaseUid: uid });
    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Get subscription info and limits
    // Use subscriptionStatus === "active" as the source of truth (not tier field)
    const subscriptionStatus =
      user.subscriptionStatus || (user as any).subscription?.subscriptionStatus;
    const isSubscribed = subscriptionStatus === "active";

    let submissionCount = 0;
    let submissionLimit: number | null = null;
    let assessmentCount = 0;
    let assessmentLimit: number | null = null;

    const enforceFreeTierAssessmentCap = shouldEnforceFreeTierAssessmentLimit();

    if (!isSubscribed) {
      // Count assessments
      const AssessmentModel = (await import("../models/assessment.js")).default;
      const SubmissionModel = (await import("../models/submission.js")).default;
      assessmentCount = await AssessmentModel.countDocuments({
        userId: user._id,
      });
      if (enforceFreeTierAssessmentCap) {
        assessmentLimit = 1; // Free tier limit: 1 assessment (production only)
      }

      // Count submissions across all user's assessments
      const userAssessments = await AssessmentModel.find({ userId: user._id });
      const assessmentIds = userAssessments.map((a) => a._id);
      submissionCount = await SubmissionModel.countDocuments({
        assessmentId: { $in: assessmentIds },
      });
    }

    const userResponse = user.toObject();
    const hackathonAdminEmail = getHackathonAdminEmail();
    const isHackathonAdmin =
      (user.email || "").toLowerCase() === hackathonAdminEmail;
    (userResponse as any).hackathonAdmin = isHackathonAdmin;
    if (isHackathonAdmin) {
      (userResponse as any).hackathonDefaultSlug =
        (user as any).hackathonDefaultSlug ?? null;
    }
    (userResponse as any).subscriptionInfo = {
      tier: isSubscribed ? "paid" : "free", // For backwards compatibility
      subscriptionStatus: subscriptionStatus || null,
      isSubscribed: isSubscribed,
      assessmentCount,
      assessmentLimit,
      submissionCount,
      submissionLimit,
      canCreateAssessment:
        isSubscribed || !enforceFreeTierAssessmentCap || assessmentCount < 1,
      canCreateSubmission: true,
    };

    res.status(200).json(userResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete user account and all associated data
 * POST /api/users/delete
 * - Cancels Stripe subscription if active
 * - Deletes all assessments (which cascades to submissions and Pinecone data)
 * - Deletes all submissions and their Pinecone data
 * - Deletes RepoIndex records
 * - Deletes Firebase Auth user
 * - Deletes user document from MongoDB
 */
export const deleteAccount: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    // Get MongoDB user ID from Firebase UID
    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    console.log(
      `🗑️ [deleteAccount] Starting account deletion for user ${userId}`,
    );

    // Step 1: Cancel Stripe subscription if active
    const subscriptionId =
      user.stripeSubscriptionId ||
      (user as any).subscription?.stripeSubscriptionId;

    if (subscriptionId) {
      try {
        // Cancel immediately (not at period end)
        await stripe.subscriptions.cancel(subscriptionId);
        console.log(
          `✅ [deleteAccount] Canceled Stripe subscription: ${subscriptionId}`,
        );
      } catch (stripeError) {
        // Log error but don't fail the deletion - subscription might already be canceled
        console.error(
          `⚠️ [deleteAccount] Failed to cancel Stripe subscription:`,
          stripeError,
        );
      }
    }

    // Step 2: Get all assessments for this user
    const assessments = await AssessmentModel.find({ userId });
    console.log(
      `📋 [deleteAccount] Found ${assessments.length} assessments to delete`,
    );

    // Step 3: For each assessment, delete it and all associated data
    for (const assessment of assessments) {
      const assessmentId = assessment._id.toString();

      // Get all submissions for this assessment
      const submissions = await SubmissionModel.find({
        assessmentId: assessmentId,
      });

      console.log(
        `🗑️ [deleteAccount] Deleting assessment ${assessmentId} with ${submissions.length} submissions`,
      );

      // Delete each submission and its associated data
      for (const submission of submissions) {
        const submissionId = submission._id.toString();

        // Delete Pinecone data if it exists
        const repoIndex = await RepoIndexModel.findOne({ submissionId });
        if (repoIndex && repoIndex.pinecone) {
          try {
            await deleteNamespace(
              repoIndex.pinecone.indexName,
              repoIndex.pinecone.namespace,
            );
            console.log(
              `✅ [deleteAccount] Deleted Pinecone namespace ${repoIndex.pinecone.namespace} for submission ${submissionId}`,
            );
          } catch (pineconeError) {
            // Log error but don't fail the deletion - Pinecone cleanup is best effort
            console.error(
              `⚠️ [deleteAccount] Failed to delete Pinecone namespace for submission ${submissionId}:`,
              pineconeError,
            );
          }
        }

        // Delete RepoIndex record
        if (repoIndex) {
          await RepoIndexModel.findByIdAndDelete(repoIndex._id);
          console.log(
            `✅ [deleteAccount] Deleted RepoIndex record for submission ${submissionId}`,
          );
        }

        // Delete the submission
        await SubmissionModel.findByIdAndDelete(submissionId);
        console.log(`✅ [deleteAccount] Deleted submission ${submissionId}`);
      }

      // Delete the assessment
      await AssessmentModel.findByIdAndDelete(assessmentId);
      console.log(`✅ [deleteAccount] Deleted assessment ${assessmentId}`);
    }

    // Step 4: Delete Firebase Auth user
    try {
      await firebaseAdminAuth.deleteUser(uid);
      console.log(`✅ [deleteAccount] Deleted Firebase user ${uid}`);
    } catch (firebaseError: any) {
      // Log error but don't fail the deletion - Firebase user might already be deleted
      console.error(
        `⚠️ [deleteAccount] Failed to delete Firebase user ${uid}:`,
        firebaseError.message,
      );
    }

    // Step 5: Delete the user document from MongoDB
    await UserModel.findByIdAndDelete(userId);
    console.log(`✅ [deleteAccount] Deleted user ${userId} from MongoDB`);

    res.status(200).json({
      success: true,
      message: "Account and all associated data deleted successfully",
      deletedAssessments: assessments.length,
    });
  } catch (error) {
    console.error("❌ [deleteAccount] Error deleting account:", error);
    next(error);
  }
};

/**
 * PATCH /api/users/hackathon-default-slug
 * Body: { slug: string | null } — null or "" clears; slug must match competition slug format.
 * Only the user whose email matches HACKATHON_ADMIN_EMAIL (default saaz.m@icloud.com).
 */
export const setHackathonDefaultSlug: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { uid } = req.body as { uid?: string };
    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }
    const user = await UserModel.findOne({ firebaseUid: uid });
    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }
    const adminEmail = getHackathonAdminEmail();
    if ((user.email || "").toLowerCase() !== adminEmail) {
      return res.status(403).json({
        error:
          "Only the designated hackathon admin can update the default competition slug.",
      });
    }

    const raw = (req.body as { slug?: string | null }).slug;
    const slug =
      raw === null || raw === undefined || raw === ""
        ? null
        : String(raw).trim().toLowerCase();

    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({
        error: "slug must be lowercase letters, numbers, and hyphens only",
      });
    }

    user.hackathonDefaultSlug = slug;
    await user.save();

    res.status(200).json({ slug: user.hackathonDefaultSlug ?? null });
  } catch (error) {
    next(error);
  }
};
