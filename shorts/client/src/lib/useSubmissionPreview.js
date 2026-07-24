import { useEffect, useMemo, useState } from "react";
import {
  getApiSubmissionPreviewUrl,
  usesApiSubmissionPreviews,
} from "@/config/submissionPreview";
import { buildPreviewBlobUrl } from "@/lib/previewBlob";

/**
 * Shared lifecycle for saved-submission iframe sources.
 *
 * API mode: returns a stable API preview URL (no object URLs / cleanup).
 * Blob mode: builds blob URLs via previewBlob.js and revokes on cleanup.
 *
 * @param {{ submissionId?: string|null, previewRevision?: string|number|Date|null, files?: Array<{path:string, content:string}>|null }} input
 * @returns {{ url: string, mode: "api"|"blob" } | null}
 */
export function useSubmissionPreview({
  submissionId,
  previewRevision,
  files,
} = {}) {
  const [blobPreview, setBlobPreview] = useState(null);

  const filesKey = useMemo(() => {
    if (!files?.length) return "";
    // Stable fingerprint so blob URLs are not rebuilt on unrelated re-renders.
    return files
      .map((f) => `${f.path}:${(f.content || "").length}`)
      .join("|");
  }, [files]);

  useEffect(() => {
    if (usesApiSubmissionPreviews) {
      setBlobPreview(null);
      return undefined;
    }
    if (!files?.length) {
      setBlobPreview(null);
      return undefined;
    }
    const built = buildPreviewBlobUrl(files);
    setBlobPreview(built);
    return () => {
      built?.revoke?.();
    };
    // filesKey captures content length + paths; files ref may change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, usesApiSubmissionPreviews]);

  return useMemo(() => {
    if (usesApiSubmissionPreviews) {
      if (!submissionId || previewRevision == null || previewRevision === "") {
        return null;
      }
      try {
        return {
          url: getApiSubmissionPreviewUrl(submissionId, previewRevision),
          mode: "api",
        };
      } catch {
        return null;
      }
    }
    if (!blobPreview?.url) return null;
    return { url: blobPreview.url, mode: "blob" };
  }, [submissionId, previewRevision, blobPreview]);
}
