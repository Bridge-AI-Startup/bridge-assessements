/**
 * Emails allowed to view cross-account ops workload (proctoring merge, transcripts,
 * behavioral grading). Override with OPS_ADMIN_EMAIL (comma-separated).
 * Defaults to the hackathon admin / founder address.
 */
export function getOpsAdminEmails(): string[] {
  const raw =
    process.env.OPS_ADMIN_EMAIL?.trim() ||
    process.env.HACKATHON_ADMIN_EMAIL?.trim() ||
    "saaz@bridge-jobs.com";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOpsAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return getOpsAdminEmails().includes(normalized);
}
