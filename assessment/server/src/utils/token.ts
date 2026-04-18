import { randomBytes } from "node:crypto";

export function generateSubmissionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function generateApiToken(): string {
  return `brk_${randomBytes(32).toString("base64url")}`;
}
