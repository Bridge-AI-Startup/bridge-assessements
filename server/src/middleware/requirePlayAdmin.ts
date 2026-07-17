import { RequestHandler } from "express";
import { AuthError } from "../errors/auth.js";
import UserModel from "../models/user.js";
import { getPlayAdminEmail } from "../utils/playAdmin.js";

/**
 * Requires Firebase auth (verifyAuthToken) and PLAY_ADMIN_EMAIL allowlist.
 */
export const requirePlayAdmin: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid?: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const user = await UserModel.findOne({ firebaseUid: uid });

    if (!user) {
      return res.status(403).json({
        error: "forbidden",
        message: "Play admin access requires a Bridge account.",
      });
    }

    const adminEmail = getPlayAdminEmail();
    if (user.email.toLowerCase() !== adminEmail) {
      return res.status(403).json({
        error: "forbidden",
        message: "You do not have permission to manage Play challenges.",
      });
    }

    (req as any).user = user;
    next();
  } catch (error) {
    next(error);
  }
};
