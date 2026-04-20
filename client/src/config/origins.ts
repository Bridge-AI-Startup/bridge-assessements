/** Marketing site (Framer) - used for "Back to landing" links from app */
export const MARKETING_ORIGIN = "https://bridge-jobs.com";

/**
 * SPA origin for candidate assessment links built in the browser (copy link, etc.).
 * When the app is deployed at app.bridge-jobs.com but recruiters might open the app
 * from a different URL, set VITE_APP_ORIGIN=https://app.bridge-jobs.com on the app build.
 * Otherwise defaults to window.location.origin.
 */
export function getAppOrigin(): string {
  const env =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_ORIGIN;
  if (env && String(env).trim()) {
    return String(env).trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "";
}
