/**
 * Path safety and limits for starterCodeFiles.
 * - No "..", no leading /, no backslashes; relative paths with forward slashes only.
 */
const MAX_FILES = 50;
const MAX_PATH_LENGTH = 200;
const MAX_CONTENT_PER_FILE_BYTES = 100 * 1024; // 100KB
const MAX_TOTAL_CONTENT_BYTES = 1024 * 1024; // 1MB

const UNSAFE_PATH_REGEX = /\.\.|\/\/|\\\\|^\//;
const CONTROL_OR_INVALID = /[\x00-\x1f\x7f]/;

export type StarterCodeFile = { path: string; content: string };

export function normalizeStarterCodePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

export function isPathSafe(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (UNSAFE_PATH_REGEX.test(path) || CONTROL_OR_INVALID.test(path))
    return false;
  return true;
}

export function validateStarterCodeFiles(
  files: unknown
): { valid: boolean; error?: string; normalized?: StarterCodeFile[] } {
  if (files === undefined || files === null) {
    return { valid: true, normalized: [] };
  }
  if (!Array.isArray(files)) {
    return { valid: false, error: "starterCodeFiles must be an array" };
  }
  if (files.length > MAX_FILES) {
    return {
      valid: false,
      error: `starterCodeFiles must have at most ${MAX_FILES} files`,
    };
  }

  const normalized: StarterCodeFile[] = [];
  let totalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        valid: false,
        error: `starterCodeFiles[${i}]: must be an object with path and content`,
      };
    }
    const path =
      typeof (item as any).path === "string"
        ? (item as any).path
        : String((item as any).path ?? "");
    const content =
      typeof (item as any).content === "string"
        ? (item as any).content
        : String((item as any).content ?? "");

    const normPath = normalizeStarterCodePath(path);
    if (!normPath) {
      return { valid: false, error: `starterCodeFiles[${i}]: path cannot be empty` };
    }
    if (!isPathSafe(normPath)) {
      return {
        valid: false,
        error: `starterCodeFiles[${i}]: path is invalid or unsafe`,
      };
    }

    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > MAX_CONTENT_PER_FILE_BYTES) {
      return {
        valid: false,
        error: `starterCodeFiles[${i}]: content exceeds ${MAX_CONTENT_PER_FILE_BYTES / 1024}KB per file`,
      };
    }
    totalBytes += contentBytes;
    if (totalBytes > MAX_TOTAL_CONTENT_BYTES) {
      return {
        valid: false,
        error: `starterCodeFiles: total content exceeds ${MAX_TOTAL_CONTENT_BYTES / 1024 / 1024}MB`,
      };
    }

    normalized.push({ path: normPath, content });
  }

  return { valid: true, normalized };
}
