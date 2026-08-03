/**
 * Bridge Shorts env helpers.
 * Prefer SHORTS_* keys; fall back to legacy PLAY_* so Render can migrate gradually.
 */

export function shortsEnabled(): boolean {
  return (
    process.env.SHORTS_ENABLED === "true" ||
    process.env.PLAY_ENABLED === "true"
  );
}

/** Read SHORTS_* first, then PLAY_*, then optional default. */
export function shortsEnv(
  shortsKey: string,
  playKey: string,
  fallback = "",
): string {
  const v =
    process.env[shortsKey]?.trim() ||
    process.env[playKey]?.trim() ||
    fallback;
  return v;
}

export function getShortsAdminEmail(): string {
  return shortsEnv(
    "SHORTS_ADMIN_EMAIL",
    "PLAY_ADMIN_EMAIL",
    "saaz.m@icloud.com",
  ).toLowerCase();
}

export function getShortsDbName(): string {
  // Keep default DB name `bridge-play` so existing Atlas data stays wired.
  return shortsEnv("SHORTS_DB_NAME", "PLAY_DB_NAME", "bridge-play");
}

export function getShortsLlmProxyPublicUrl(): string {
  return shortsEnv("SHORTS_LLM_PROXY_PUBLIC_URL", "PLAY_LLM_PROXY_PUBLIC_URL");
}

/**
 * Public base URL of this API as the *browser* should reach it (serverless
 * preview iframes). Empty unless explicitly set; see getShortsPublicApiBase().
 */
export function getShortsPublicApiUrl(): string {
  return shortsEnv("SHORTS_PUBLIC_API_URL", "PLAY_PUBLIC_API_URL");
}

export function getShortsMaxConcurrentSessions(): string {
  return shortsEnv(
    "SHORTS_MAX_CONCURRENT_SESSIONS",
    "PLAY_MAX_CONCURRENT_SESSIONS",
  );
}

export function getShortsBuildTimeLimitMinutes(): string {
  return shortsEnv(
    "SHORTS_BUILD_TIME_LIMIT_MINUTES",
    "PLAY_BUILD_TIME_LIMIT_MINUTES",
  );
}

export function getShortsChallengeCadence(): string {
  return shortsEnv("SHORTS_CHALLENGE_CADENCE", "PLAY_CHALLENGE_CADENCE", "weekly");
}

export function getShortsAnthropicModel(): string {
  return shortsEnv("SHORTS_ANTHROPIC_MODEL", "PLAY_ANTHROPIC_MODEL");
}

export type ShortsMakeMode = "e2b" | "serverless";

/**
 * Which "make" path builds serve. `e2b` (default) provisions a sandbox running
 * Claude Code; `serverless` generates a single self-contained HTML file via a
 * direct Anthropic Messages call (no sandbox). Switch with one env var; the mode
 * is stamped per-session at creation so flipping it never mis-routes live sessions.
 */
export function getShortsMakeMode(): ShortsMakeMode {
  const raw = shortsEnv("SHORTS_MAKE_MODE", "PLAY_MAKE_MODE", "e2b").toLowerCase();
  return raw === "serverless" ? "serverless" : "e2b";
}
