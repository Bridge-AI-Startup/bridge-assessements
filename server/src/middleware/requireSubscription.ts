/**
 * Middleware to require active subscription
 * Blocks access to paid routes if user is not subscribed
 */

import { RequestHandler } from "express";
import { AuthError } from "../errors/auth.js";
import { getUserIdFromFirebaseUid } from "../util/auth.js";
import UserModel from "../models/user.js";
import { isSubscribed } from "../util/subscription.js";

/**
 * Middleware that requires an active subscription
 * Returns 402 Payment Required if user is not subscribed
 */
export const requireSubscription: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const userId = await getUserIdFromFirebaseUid(uid);
    const user = await UserModel.findById(userId);

    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    if (!isSubscribed(user)) {
      return res.status(402).json({
        error: "SUBSCRIPTION_REQUIRED",
        message: "An active subscription is required to access this feature.",
      });
    }

    // Attach user to request for downstream handlers
    (req as any).user = user;
    next();
  } catch (error) {
    next(error);
  }
};
