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
    const userInfo = await firebaseAdminAuth.verifyIdToken(token);
    return userInfo;
  } catch (error) {
    console.error("Token decode error:", error);
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
