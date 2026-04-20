/**
 * Base URL for links that must open the React app (candidate assessment, invite emails, etc.).
 *
 * Production often splits:
 * - Marketing / landing: https://bridge-jobs.com or https://www.bridge-jobs.com
 * - SPA (Vite): https://app.bridge-jobs.com
 *
 * Set CANDIDATE_APP_URL to the SPA origin in production. If unset, falls back to APP_URL
 * (Stripe success URLs should use the same SPA origin), then FRONTEND_URL for local dev.
 */
export function getCandidateAppBaseUrl(): string {
  const raw =
    process.env.CANDIDATE_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}
