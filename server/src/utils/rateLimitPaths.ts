/**
 * Path helpers for express-rate-limit skip functions.
 *
 * High-volume products (Shorts Build polls, gallery iframes, proctoring
 * frames) must not share the general 100/15min API bucket. Keep these in
 * lockstep with the mounts in server.ts.
 */

function pathOnly(url: string): string {
  return url.split("?")[0] || "";
}

/** Assessment screen-capture uploads — own 8000/15min limiter. */
export function isProctoringPath(url: string): boolean {
  return pathOnly(url).startsWith("/api/proctoring");
}

/**
 * Bridge Shorts (and the legacy `/api/play` alias). Build polls usage,
 * session, and workspace-revision on a timer; E2B sandboxes also hit the
 * LLM proxy from shared egress IPs. All of it belongs on a dedicated
 * ceiling, not the general API cap.
 */
export function isShortsApiPath(url: string): boolean {
  const path = pathOnly(url);
  return path.startsWith("/api/shorts") || path.startsWith("/api/play");
}

/** Gallery iframe assets — own 3000/15min limiter, not the Shorts API bucket. */
export function isShortsPreviewPath(url: string): boolean {
  const path = pathOnly(url);
  return (
    path === "/api/shorts/preview" ||
    path.startsWith("/api/shorts/preview/") ||
    path === "/api/play/preview" ||
    path.startsWith("/api/play/preview/")
  );
}

/** Paths that must never consume the general 100/15min API limiter. */
export function skipGeneralApiLimit(url: string): boolean {
  return isProctoringPath(url) || isShortsApiPath(url);
}
