/**
 * Mint real Firebase ID tokens via the Identity Toolkit REST API using the
 * public web API key. The backend's verifyAuthToken middleware verifies these
 * tokens with the Admin SDK, so this exercises the genuine auth path.
 */

import { FIREBASE_WEB_API_KEY } from "./config.js";

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";

export interface FirebaseAuthResult {
  idToken: string;
  refreshToken: string;
  localId: string; // Firebase UID
  email: string;
}

async function call(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${IDENTITY_BASE}/${path}?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(`Firebase ${path} failed: ${msg}`);
  }
  return json;
}

/** Create a brand new Firebase user and return a fresh ID token. */
export async function signUp(
  email: string,
  password: string
): Promise<FirebaseAuthResult> {
  const json = await call("accounts:signUp", {
    email,
    password,
    returnSecureToken: true,
  });
  return {
    idToken: json.idToken,
    refreshToken: json.refreshToken,
    localId: json.localId,
    email,
  };
}

/** Sign in an existing Firebase user (used to prove re-auth works). */
export async function signIn(
  email: string,
  password: string
): Promise<FirebaseAuthResult> {
  const json = await call("accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });
  return {
    idToken: json.idToken,
    refreshToken: json.refreshToken,
    localId: json.localId,
    email,
  };
}

/** Delete a Firebase user by ID token (best-effort cleanup). */
export async function deleteFirebaseUser(idToken: string): Promise<void> {
  await call("accounts:delete", { idToken }).catch(() => {
    /* best effort */
  });
}
