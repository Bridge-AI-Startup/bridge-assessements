/**
 * Fallback competition slug when the URL has no ?slug= and the API returns no default.
 * Resolution order: ?slug= → VITE_DEFAULT_COMPETITION_SLUG → GET /api/competitions/hackathon-default
 * (hackathon admin account) → this constant.
 *
 * Default slug points at the assessment titled "The Challenge" in MongoDB.
 */
export const SINGLE_COMPETITION_SLUG = "the-challenge";

/** Public name for this experience (HackathonDashboard + home admin card). */
export const CHALLENGE_BRAND_NAME = "The Challenge";

/** Pre-launch countdown on /HackathonDashboard — set to `false` when you ship. Env can override. */
export const HACKATHON_RELEASE_COUNTDOWN_ENABLED = true;

/**
 * Optional env overrides the flag: VITE_HACKATHON_COUNTDOWN_ENABLED=false
 */
export function hackathonReleaseCountdownEnabled() {
  const env =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_HACKATHON_COUNTDOWN_ENABLED;
  if (env === "false" || env === "0") return false;
  if (env === "true" || env === "1") return true;
  return HACKATHON_RELEASE_COUNTDOWN_ENABLED;
}

/**
 * Go-live instant (ISO 8601). Set ~24h before launch, or use env VITE_HACKATHON_RELEASE_AT.
 * When wall-clock passes this, the banner switches to “Challenge is live”.
 */
export const HACKATHON_RELEASE_AT_ISO_DEFAULT = "2026-04-18T12:00:00.000Z";

export function hackathonReleaseAtIso() {
  const fromEnv =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_HACKATHON_RELEASE_AT
      ? String(import.meta.env.VITE_HACKATHON_RELEASE_AT).trim()
      : "";
  return fromEnv || HACKATHON_RELEASE_AT_ISO_DEFAULT;
}

/**
 * True while the pre-launch countdown is on and wall time is before `hackathonReleaseAtIso()`.
 * Pass `atMs` from a ticking clock in React so the UI unlocks when the timer hits zero.
 */
export function isHackathonJoinBlocked(atMs = Date.now()) {
  if (!hackathonReleaseCountdownEnabled()) return false;
  const t = Date.parse(hackathonReleaseAtIso());
  if (!Number.isFinite(t)) return false;
  return atMs < t;
}
