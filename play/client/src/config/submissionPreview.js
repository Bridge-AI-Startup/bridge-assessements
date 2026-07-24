/**
 * Toggleable saved-submission preview mode for Bridge Play.
 *
 * Change this single constant to roll the client between implementations:
 *   - "api"  → iframe loads GET /api/play/preview/:id/:revision/*
 *   - "blob" → legacy client-built blob: URLs (requires files in JSON payloads)
 *
 * No env var, localStorage, or UI toggle. Redeploy / restart Vite after flipping.
 * Backend preview routes can stay deployed either way (includeFiles defaults true).
 */
import { API_BASE_URL } from "@/config/api.js";

/** @type {"api" | "blob"} */
export const SUBMISSION_PREVIEW_MODE = "api"; // change to "blob" to roll back

export const usesApiSubmissionPreviews = SUBMISSION_PREVIEW_MODE === "api";
export const usesBlobSubmissionPreviews = SUBMISSION_PREVIEW_MODE === "blob";

/** Whether public submission / vote APIs should return the full `files` array. */
export const shouldFetchSubmissionFiles = usesBlobSubmissionPreviews;

function assertValidMode() {
  if (
    SUBMISSION_PREVIEW_MODE !== "api" &&
    SUBMISSION_PREVIEW_MODE !== "blob"
  ) {
    throw new Error(
      `Invalid SUBMISSION_PREVIEW_MODE "${SUBMISSION_PREVIEW_MODE}" (expected "api" or "blob")`,
    );
  }
}

function toRevisionMs(submittedAt) {
  if (submittedAt instanceof Date) {
    const ms = submittedAt.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error("Invalid submittedAt Date for preview URL");
    }
    return String(Math.trunc(ms));
  }
  if (typeof submittedAt === "number") {
    if (!Number.isFinite(submittedAt)) {
      throw new Error("Invalid submittedAt number for preview URL");
    }
    return String(Math.trunc(submittedAt));
  }
  const raw = String(submittedAt ?? "").trim();
  if (!raw) {
    throw new Error("Missing submittedAt for preview URL");
  }
  if (/^\d{10,16}$/.test(raw)) {
    return raw;
  }
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid submittedAt for preview URL: ${raw}`);
  }
  return String(Math.trunc(ms));
}

/**
 * Build the API-origin preview URL for a saved submission.
 * @param {string} submissionId
 * @param {string|number|Date} submittedAt ISO date, Date, or epoch-ms revision
 */
export function getApiSubmissionPreviewUrl(submissionId, submittedAt) {
  assertValidMode();
  const id = String(submissionId ?? "").trim();
  if (!id) {
    throw new Error("Missing submission id for preview URL");
  }
  const revision = toRevisionMs(submittedAt);
  return `${API_BASE_URL}/preview/${encodeURIComponent(id)}/${encodeURIComponent(revision)}/`;
}
