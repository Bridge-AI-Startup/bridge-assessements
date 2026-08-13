import JSZip from "jszip";

export const STARTER_ZIP_FILENAME = "starter-code.zip";

/**
 * @param {{ path: string, content?: string }[] | null | undefined} files
 * @returns {Promise<Blob | null>}
 */
export async function buildStarterCodeZipBlob(files) {
  if (!files?.length) return null;
  const zip = new JSZip();
  for (const file of files) {
    if (!file?.path) continue;
    zip.file(file.path, file.content ?? "");
  }
  return zip.generateAsync({ type: "blob" });
}

/**
 * Trigger a file download from an already-created object URL (keeps the
 * click in the user-gesture chain so the browser does not block it).
 * @param {string} objectUrl
 * @param {string} [filename]
 */
export function triggerBlobDownload(objectUrl, filename = STARTER_ZIP_FILENAME) {
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Build a zip of starter files and download it. Prefer pre-building the blob
 * and calling `triggerBlobDownload` from a click handler when possible.
 * @param {{ path: string, content?: string }[] | null | undefined} files
 * @param {string} [filename]
 * @returns {Promise<boolean>}
 */
export async function downloadStarterCodeZip(
  files,
  filename = STARTER_ZIP_FILENAME
) {
  const blob = await buildStarterCodeZipBlob(files);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  triggerBlobDownload(url, filename);
  URL.revokeObjectURL(url);
  return true;
}
