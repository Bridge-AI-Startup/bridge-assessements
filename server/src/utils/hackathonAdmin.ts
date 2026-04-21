/**
 * Email of the Bridge account that may set the public default hackathon competition slug
 * (stored on that user's document). Override with HACKATHON_ADMIN_EMAIL.
 */
export function getHackathonAdminEmail(): string {
  return (process.env.HACKATHON_ADMIN_EMAIL || "saaz@bridge-jobs.com")
    .trim()
    .toLowerCase();
}
