import { RequestHandler } from "express";
import { AuthError } from "../errors/auth.js";
import UserModel from "../models/user.js";
import { isOpsAdminEmail } from "../utils/opsAdmin.js";

/**
 * Requires Firebase auth (verifyAuthToken) and OPS_ADMIN_EMAIL allowlist.
 * Cross-account view — only for crash / workload diagnosis.
 */
export const requireOpsAdmin: RequestHandler = async (req, res, next) => {
  try {
    const { uid } = req.body as { uid?: string };

    if (!uid) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }

    const user = await UserModel.findOne({ firebaseUid: uid });

    if (!user) {
      return res.status(403).json({
        error: "forbidden",
        message: "Ops access requires a Bridge account.",
      });
    }

    if (!isOpsAdminEmail(user.email)) {
      return res.status(403).json({
        error: "forbidden",
        message: "You do not have permission to view the ops workload dashboard.",
      });
    }

    (req as any).opsUser = user;
    next();
  } catch (error) {
    next(error);
  }
};
