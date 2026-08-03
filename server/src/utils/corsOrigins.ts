/**
 * CORS origin matching for local development.
 *
 * The production allowlist in `server.ts` is an exact-match list and stays
 * that way. Development is different: Vite picks a new port whenever the
 * default is taken (a second client, a stale dev server), and developers
 * reach the app on `127.0.0.1` as often as `localhost`. A fixed three-port
 * list rejects both cases.
 *
 * A rejected origin is expensive to diagnose because the browser hides it:
 * the CORS middleware's error produces a 500 that carries no
 * `Access-Control-Allow-Origin` header, so the page never sees the status
 * and `fetch` reports only `TypeError: Failed to fetch`.
 */

/** Loopback host with an explicit port, http or https. */
const DEV_LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

/**
 * True when `origin` is a loopback origin and we are running in development.
 *
 * `nodeEnv` is the raw `process.env.NODE_ENV`, deliberately not a value that
 * falls back to "development" when unset: an unset NODE_ENV on a real deploy
 * must not widen CORS. Anything other than exactly "development" is false, so
 * production keeps exact-match only.
 */
export function isDevLoopbackOrigin(
  origin: string,
  nodeEnv: string | undefined,
): boolean {
  return nodeEnv === "development" && DEV_LOOPBACK_ORIGIN.test(origin);
}
