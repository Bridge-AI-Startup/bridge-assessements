/**
 * Email of the Bridge account that may manage Play daily challenges.
 * Override with PLAY_ADMIN_EMAIL.
 */
export function getPlayAdminEmail(): string {
  return (process.env.PLAY_ADMIN_EMAIL || "saaz.m@icloud.com")
    .trim()
    .toLowerCase();
}
