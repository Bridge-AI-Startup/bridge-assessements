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
import { shortsEnv, getShortsOgImageUrl } from "../../utils/shortsEnv.js";

/** Browser-facing base URL of the Shorts client app. */
export function getShortsClientBase(): string {
  const explicit = shortsEnv("SHORTS_FRONTEND_URL", "PLAY_FRONTEND_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  return process.env.NODE_ENV === "production"
    ? "https://shorts.bridge-jobs.com"
    : "http://localhost:5174";
}

/* ------------------------------------------------------------------ *
 * Share card image (og:image)
 *
 * One static card for the whole product for now: round-agnostic, so it
 * never goes stale. It lives in the Shorts client's `public/` tree, which
 * Vercel serves at `<client base>/og/shorts-card.png` — the same base the
 * canonical URL is built from, so there is exactly one base-URL resolver.
 * ------------------------------------------------------------------ */

/** Path of the committed card, relative to the Shorts client base. */
const DEFAULT_OG_IMAGE_PATH = "/og/shorts-card.png";

/**
 * Whether the file above is actually committed at
 * `shorts/client/public/og/shorts-card.png`. A broken og:image renders a
 * WORSE card than no image at all (crawlers show an empty/failed thumbnail
 * frame), so if that asset is ever deleted or renamed, flip this to `false`
 * and the page degrades to exactly its pre-image behaviour: no image tags
 * and `twitter:card: summary`.
 *
 * Regenerate the asset with:
 *   cd server && npx tsx src/scripts/generateShortsOgCard.ts
 */
const DEFAULT_OG_IMAGE_COMMITTED = true;

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const OG_IMAGE_ALT =
  "Bridge Shorts — one challenge, one week, everyone gets the same model.";

/**
 * Absolute URL of the share card, or `null` when we cannot vouch for one.
 * `SHORTS_OG_IMAGE_URL` (legacy `PLAY_OG_IMAGE_URL`) repoints the card without
 * a deploy; it must be an absolute http(s) URL, because a relative or
 * junk value would produce the broken-thumbnail case this whole function
 * exists to avoid (and, being interpolated into a meta tag, must not be
 * allowed to carry a `javascript:`-style scheme).
 */
function resolveOgImageUrl(): string | null {
  const override = getShortsOgImageUrl();
  if (override) {
    try {
      const parsed = new URL(override);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      /* not a URL at all */
    }
    // Unusable override: fall through to the committed default rather than
    // shipping a value we know a crawler cannot fetch.
  }
  if (!DEFAULT_OG_IMAGE_COMMITTED) return null;
  return `${getShortsClientBase()}${DEFAULT_OG_IMAGE_PATH}`;
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
  const imageUrl = resolveOgImageUrl();
  // No vouched-for image → emit no image tags at all and keep the small
  // `summary` card. A card with a broken image is worse than a text card.
  const imageTags = imageUrl
    ? [
        `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
        `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">`,
        `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">`,
        `<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}">`,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
        `<meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}">`,
      ]
    : [];
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
    ...imageTags,
    `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">`,
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
