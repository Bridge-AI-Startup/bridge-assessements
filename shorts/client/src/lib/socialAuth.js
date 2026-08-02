import {
  GoogleAuthProvider,
  OAuthProvider,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/firebase/firebase";

export const GOOGLE_PROVIDER_ID = "google.com";
export const APPLE_PROVIDER_ID = "apple.com";

/** Human label for a Firebase provider id, for collision messaging. */
export function providerLabel(providerId) {
  if (providerId === GOOGLE_PROVIDER_ID) return "Google";
  if (providerId === APPLE_PROVIDER_ID) return "Apple";
  if (providerId === "password") return "email and password";
  return providerId;
}

function buildProvider(providerId) {
  if (providerId === GOOGLE_PROVIDER_ID) {
    const provider = new GoogleAuthProvider();
    // Always let people choose which Google account, rather than silently
    // reusing the one the browser happens to be signed into.
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }
  const provider = new OAuthProvider(APPLE_PROVIDER_ID);
  provider.addScope("email");
  provider.addScope("name");
  return provider;
}

/** Pull the pending credential off a failed social sign-in, if there is one. */
export function credentialFromError(providerId, err) {
  try {
    return providerId === GOOGLE_PROVIDER_ID
      ? GoogleAuthProvider.credentialFromError(err)
      : OAuthProvider.credentialFromError(err);
  } catch {
    return null;
  }
}

/**
 * Popup sign-in. Redirect is deliberately not used: the Firebase auth handler
 * lives on a different domain than the Shorts client, and browsers that
 * partition third-party storage (Safari 16.1+, Chrome privacy sandbox) break
 * signInWithRedirect in that setup.
 */
export async function signInWithProvider(providerId) {
  const result = await signInWithPopup(auth, buildProvider(providerId));
  return result.user;
}

/**
 * Attach a credential that was left pending by an
 * `auth/account-exists-with-different-credential` failure. Call once the user
 * has signed in through the provider that already owns the email.
 */
export async function linkPendingCredential(pendingCredential) {
  if (!pendingCredential || !auth.currentUser) return false;
  await linkWithCredential(auth.currentUser, pendingCredential);
  return true;
}

/**
 * Which providers already own this email. Returns [] when Firebase's email
 * enumeration protection is on (the default for newer projects), so callers
 * must handle an empty list as "unknown", not "no account".
 */
export async function existingSignInMethods(email) {
  if (!email) return [];
  try {
    return await fetchSignInMethodsForEmail(auth, email);
  } catch {
    return [];
  }
}

/** Maps Firebase auth errors to something a person can act on. */
export function socialAuthErrorMessage(providerId, err) {
  const code = err?.code || "";
  const label = providerLabel(providerId);

  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  ) {
    return null; // User backed out on purpose — not an error worth showing.
  }
  if (code === "auth/popup-blocked") {
    return `Your browser blocked the ${label} sign-in window. Allow popups for this site and try again.`;
  }
  if (code === "auth/operation-not-allowed") {
    return `${label} sign-in isn't enabled for this project yet. Enable the ${label} provider in the Firebase console.`;
  }
  if (code === "auth/unauthorized-domain") {
    return `This domain isn't in the Firebase authorized domains list, so ${label} sign-in is blocked here.`;
  }
  if (code === "auth/invalid-credential" || code === "auth/invalid-oauth-provider") {
    return `${label} sign-in is misconfigured. Check the provider setup in the Firebase console.`;
  }
  if (code === "auth/network-request-failed") {
    return "Network error — check your connection and try again.";
  }
  return err?.message || `Could not sign in with ${label}.`;
}
