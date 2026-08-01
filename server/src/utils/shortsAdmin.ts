import { getShortsAdminEmail } from "./shortsEnv.js";

/**
 * Email of the Bridge account that may manage Shorts daily challenges.
 * Override with SHORTS_ADMIN_EMAIL (legacy: PLAY_ADMIN_EMAIL).
 */
export function getPlayAdminEmail(): string {
  return getShortsAdminEmail();
}
