/**
 * Social share page for Shorts submissions.
 *
 * The share URL people send around is the ordinary client page
 * (`/Submission?id=…`). The Shorts Vercel project rewrites requests to that
 * path onto this endpoint ONLY when the user-agent is a social link crawler
 * (iMessage, WhatsApp, X, Slack, …), so crawlers get real OpenGraph tags while
 * humans get the SPA. Humans can still land here if they follow the API URL
 * directly — the page meta-refreshes them to the client page.
 */
import { Types } from "mongoose";
import { getPlaySubmissionModel } from "../../models/shorts/submission.js";
import { getChallengeBySlug } from "./challenges.js";
import { shortsEnv } from "../../utils/shortsEnv.js";

/** Browser-facing base URL of the Shorts client app. */
export function getShortsClientBase(): string {
  const explicit = shortsEnv("SHORTS_FRONTEND_URL", "PLAY_FRONTEND_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.NODE_ENV === "production"
    ? "https://shorts.bridge-jobs.com"
    : "http://localhost:5174";
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOgDocument(input: {
  title: string;
  description: string;
  canonicalUrl: string;
}): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const url = escapeHtml(input.canonicalUrl);
  // Everything interpolated below is already HTML-escaped.
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Bridge Shorts">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<link rel="canonical" href="${url}">`,
    // Crawlers ignore the refresh and read the tags; humans get moved along.
    `<meta http-equiv="refresh" content="0;url=${url}">`,
    "</head>",
    "<body>",
    `<p>Redirecting to <a href="${url}">${title}</a>…</p>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Render OG HTML for a submission id. Unknown / invalid ids fall back to a
 * generic Bridge Shorts card pointing at the gallery — a 404 would leave the
 * shared message with no preview at all, which is strictly worse.
 */
export async function renderSubmissionSharePage(
  rawId: string | undefined,
): Promise<string> {
  const base = getShortsClientBase();
  const fallback = () =>
    renderOgDocument({
      title: "Bridge Shorts",
      description:
        "A weekly build challenge — make something small and fun with AI, then the community votes.",
      canonicalUrl: `${base}/Gallery`,
    });

  const id = String(rawId || "").trim();
  if (!Types.ObjectId.isValid(id)) return fallback();

  const PlaySubmission = getPlaySubmissionModel();
  const doc = await PlaySubmission.findById(id)
    .select({ displayName: 1, challengeSlug: 1, challengeDate: 1 })
    .lean();
  if (!doc) return fallback();

  const challenge = await getChallengeBySlug(doc.challengeSlug).catch(
    () => null,
  );
  const challengeTitle =
    (challenge as { title?: string } | null)?.title || "this week's challenge";

  return renderOgDocument({
    title: `“${doc.displayName}” — ${challengeTitle} · Bridge Shorts`,
    description: `A build for the “${challengeTitle}” challenge on Bridge Shorts. Open it, try it, then vote on this round's builds.`,
    canonicalUrl: `${base}/Submission?id=${encodeURIComponent(id)}`,
  });
}
