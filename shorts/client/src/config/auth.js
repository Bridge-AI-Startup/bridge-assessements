/**
 * Which social sign-in providers the Shorts client offers.
 *
 * These are display gates only — the code paths in `lib/socialAuth.js` work for
 * both providers and are left intact when a provider is hidden.
 *
 * A provider must ALSO be enabled in the Firebase console (Authentication →
 * Sign-in method), or sign-in fails with `auth/operation-not-allowed`.
 *
 * Apple is OFF until its Apple Developer prerequisites exist (paid developer
 * account, Services ID with return URL
 * https://bridge-assessments.firebaseapp.com/__/auth/handler, and a Sign in
 * with Apple key registered in Firebase). Showing the button before then is a
 * guaranteed dead end. Flip this to true — or set VITE_SHORTS_APPLE_AUTH=true —
 * once that setup is done; no other code changes are needed.
 *
 * Override per environment with Vite env vars, e.g. in shorts/client/.env.local:
 *   VITE_SHORTS_APPLE_AUTH=true
 *   VITE_SHORTS_GOOGLE_AUTH=false
 */

function envFlag(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export const GOOGLE_AUTH_ENABLED = envFlag(
  import.meta.env.VITE_SHORTS_GOOGLE_AUTH,
  true,
);

export const APPLE_AUTH_ENABLED = envFlag(
  import.meta.env.VITE_SHORTS_APPLE_AUTH,
  false,
);

export const ANY_SOCIAL_AUTH_ENABLED =
  GOOGLE_AUTH_ENABLED || APPLE_AUTH_ENABLED;
