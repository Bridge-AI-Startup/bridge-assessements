/**
 * Authentication utility functions
 * Handles Firebase token verification
 * Following HomeWork pattern
 */

import { AuthError } from "../errors/auth.ts";
import { firebaseAdminAuth } from "./firebase.ts";

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
