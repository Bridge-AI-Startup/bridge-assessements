import { auth } from "../config/firebaseAdmin.js";

/**
 * Middleware to verify Firebase ID token
 * Adds user info to req.user if token is valid
 */
export const verifyToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "No token provided",
      });
    }

    const token = authHeader.split("Bearer ")[1];

    // Verify the token
    const decodedToken = await auth.verifyIdToken(token);

    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name || decodedToken.display_name,
    };

    next();
  } catch (error) {
    console.error("Token verification error:", error);

    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({
        success: false,
        error: "Token expired",
        message: "Your session has expired. Please sign in again.",
      });
    }

    if (error.code === "auth/argument-error") {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
        message: "The provided token is invalid.",
      });
    }

    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  }
};

/**
 * Optional middleware - doesn't fail if no token
 * Useful for routes that work with or without auth
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split("Bearer ")[1];
      const decodedToken = await auth.verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        name: decodedToken.name || decodedToken.display_name,
      };
    }

    next();
  } catch (error) {
    // Continue without auth if token is invalid
    next();
  }
};
