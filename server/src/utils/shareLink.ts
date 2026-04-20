const DEFAULT_PRODUCTION_CANDIDATE_APP = "https://app.bridge-jobs.com";

/**
 * Base URL for candidate assessment share links (generate-link, bulk, email invites, competition join).
 * Production defaults to https://app.bridge-jobs.com. Set SHARE_LINK_BASE_URL to override (e.g. staging).
 */
export function getShareLinkBaseUrl(): string {
  const explicit = process.env.SHARE_LINK_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV !== "production") {
    return (
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      "http://localhost:5173"
    ).replace(/\/$/, "");
  }
  return DEFAULT_PRODUCTION_CANDIDATE_APP;
}
