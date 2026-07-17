/**
 * Interactive list/read/write of Play sandbox project files (Monaco editor sync).
 */
import createHttpError from "http-errors";
import type { Sandbox } from "e2b";
import { Types } from "mongoose";
import { getPlayBuildSessionModel } from "../../models/play/buildSession.js";
import {
  PLAY_WORKSPACE,
  runPlayCommand,
  connectPlaySandbox,
} from "./sandbox.js";
import {
  upsertSessionWorkspaceFile,
  e2bTimeoutMsForChallengeDay,
} from "./sessionPersist.js";

const LIST_MAX_FILES = 200;
const READ_MAX_FILE_BYTES = 512 * 1024; // 512 KB
const WRITE_MAX_FILE_BYTES = 512 * 1024;

const SKIP_DIR_PATTERN = /(^|\/)(node_modules|\.git)(\/|$)/;

export type ProjectFileEntry = {
  path: string;
  sizeBytes?: number;
};

function looksBinary(content: string): boolean {
  if (content.includes("\0")) return true;
  const sample = content.slice(0, 8000);
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) > 0.1;
}

/**
 * Normalize and validate a relative project path. Rejects absolute paths and `..`.
 */
export function sanitizeProjectRelPath(raw: string): string {
  let p = String(raw || "").trim().replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/^\/+/, "");
  if (!p) {
    throw createHttpError(400, "path is required");
  }
  if (p.includes("\0") || p.split("/").some((seg) => seg === "..")) {
    throw createHttpError(400, "invalid path");
  }
  if (SKIP_DIR_PATTERN.test(p)) {
    throw createHttpError(400, "path not allowed");
  }
  if (p.length > 512) {
    throw createHttpError(400, "path too long");
  }
  return p;
}

function absPath(rel: string): string {
  return `${PLAY_WORKSPACE}/${rel}`;
}

export async function listProjectFiles(
  sandbox: Sandbox,
): Promise<ProjectFileEntry[]> {
  const listCmd = [
    `cd ${PLAY_WORKSPACE}`,
    `&& find . -maxdepth 8 -type f`,
    `! -path '*/node_modules/*'`,
    `! -path '*/.git/*'`,
    `| head -n ${LIST_MAX_FILES + 20}`,
  ].join(" ");

  const listed = await runPlayCommand(sandbox, listCmd, {
    timeoutMs: 30_000,
  });
  if (listed.exitCode !== 0) {
    throw createHttpError(
      502,
      `Failed to list project files: ${listed.stderr || listed.stdout || "unknown"}`,
    );
  }

  const relativePaths = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("./") ? p.slice(2) : p.replace(/^\.\//, "")))
    .filter((p) => p && !SKIP_DIR_PATTERN.test(p));

  if (relativePaths.length > LIST_MAX_FILES) {
    throw createHttpError(
      400,
      `Project has too many files (max ${LIST_MAX_FILES})`,
    );
  }

  return relativePaths.map((path) => ({ path }));
}

export async function readProjectFile(
  sandbox: Sandbox,
  relPath: string,
): Promise<{ path: string; content: string }> {
  const rel = sanitizeProjectRelPath(relPath);
  const abs = absPath(rel);
  let content: string;
  try {
    content = await sandbox.files.read(abs);
  } catch {
    throw createHttpError(404, "file_not_found");
  }
  if (typeof content !== "string") {
    throw createHttpError(400, "file is not readable text");
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > READ_MAX_FILE_BYTES) {
    throw createHttpError(400, "file too large");
  }
  if (looksBinary(content)) {
    throw createHttpError(400, "binary files are not supported");
  }
  return { path: rel, content };
}

export async function writeProjectFile(
  sandbox: Sandbox,
  relPath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const rel = sanitizeProjectRelPath(relPath);
  if (typeof content !== "string") {
    throw createHttpError(400, "content must be a string");
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > WRITE_MAX_FILE_BYTES) {
    throw createHttpError(400, "file too large");
  }
  if (looksBinary(content)) {
    throw createHttpError(400, "binary content is not supported");
  }

  const abs = absPath(rel);
  const dir = abs.includes("/") ? abs.slice(0, abs.lastIndexOf("/")) : PLAY_WORKSPACE;
  await runPlayCommand(sandbox, `mkdir -p ${JSON.stringify(dir)}`, {
    timeoutMs: 10_000,
  });

  try {
    await sandbox.files.write(abs, content);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "failed to write file";
    throw createHttpError(502, `Sandbox write failed: ${message}`);
  }

  return { path: rel, bytes };
}

/** Connect to the E2B sandbox for an owned, active Play session. */
export async function connectOwnedActiveSandbox(
  sessionId: string,
  anonymousId: string,
): Promise<Sandbox> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw createHttpError(400, "invalid session id");
  }
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status !== "active" || !doc.e2bSandboxId) {
    throw createHttpError(400, "session_not_active");
  }

  const sandboxId = doc.e2bSandboxId;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await connectPlaySandbox(sandboxId, {
        timeoutMs: e2bTimeoutMsForChallengeDay(doc.challengeDate),
      });
    } catch (err) {
      lastErr = err;
      console.warn(
        `[play/workspaceFiles] Sandbox.connect failed (attempt ${attempt + 1}/3) ${sandboxId}:`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  // Only expire after retries — transient E2B connect blips are common right after create.
  doc.status = "expired";
  doc.error = "Sandbox no longer reachable";
  await doc.save().catch(() => undefined);
  throw createHttpError(
    502,
    `Sandbox no longer reachable${
      lastErr instanceof Error ? `: ${lastErr.message}` : ""
    }`,
  );
}

export async function listSessionProjectFiles(
  sessionId: string,
  anonymousId: string,
): Promise<{ files: ProjectFileEntry[] }> {
  const sandbox = await connectOwnedActiveSandbox(sessionId, anonymousId);
  const files = await listProjectFiles(sandbox);
  return { files };
}

export async function readSessionProjectFile(
  sessionId: string,
  anonymousId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  const sandbox = await connectOwnedActiveSandbox(sessionId, anonymousId);
  return readProjectFile(sandbox, path);
}

export async function writeSessionProjectFile(
  sessionId: string,
  anonymousId: string,
  path: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const sandbox = await connectOwnedActiveSandbox(sessionId, anonymousId);
  const result = await writeProjectFile(sandbox, path, content);
  try {
    await upsertSessionWorkspaceFile(sessionId, result.path, content);
  } catch (err) {
    console.warn(
      "[play/workspaceFiles] snapshot upsert failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return result;
}
