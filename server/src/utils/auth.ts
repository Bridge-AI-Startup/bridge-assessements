/**
 * Authentication utility functions
 * Handles Firebase token verification
 * Following HomeWork pattern
 */

import { AuthError } from "../errors/auth.ts";
import { firebaseAdminAuth } from "./firebase.ts";
import UserModel from "../models/user.js";

/**
 * Verifies a Firebase ID token and returns decoded user info
 * Following HomeWork pattern - throws AuthError on failure
 * @param token - The Firebase ID token
 * @returns Decoded token with user information
 * @throws AuthError if token is invalid
 */
export async function decodeAuthToken(token: string) {
  try {
    // Check if Firebase Admin is properly initialized
    if (!firebaseAdminAuth || typeof firebaseAdminAuth.verifyIdToken !== 'function') {
      console.error("❌ [decodeAuthToken] Firebase Admin Auth is not initialized");
      throw new Error("Firebase Admin SDK not initialized. Check server logs for initialization errors.");
    }
    
    const userInfo = await firebaseAdminAuth.verifyIdToken(token);
    return userInfo;
  } catch (error: any) {
    console.error("❌ [decodeAuthToken] Token verification failed:", error);
    
    // Provide more specific error messages
    if (error?.code === 'auth/id-token-expired') {
      console.error("   Token has expired");
    } else if (error?.code === 'auth/id-token-revoked') {
      console.error("   Token has been revoked");
    } else if (error?.code === 'auth/argument-error') {
      console.error("   Invalid token format");
    } else if (error?.message?.includes('not initialized')) {
      console.error("   Firebase Admin SDK not initialized");
    }
    
    throw AuthError.DECODE_ERROR;
  }
}

/**
 * Gets MongoDB user ID from Firebase UID
 * @param firebaseUid - The Firebase UID
 * @returns MongoDB user ID as string
 * @throws Error if user not found
 */
export async function getUserIdFromFirebaseUid(
  firebaseUid: string
): Promise<string> {
  const user = await UserModel.findOne({ firebaseUid });
  if (!user) {
    throw new Error("User not found");
  }
  return user._id.toString();
}
