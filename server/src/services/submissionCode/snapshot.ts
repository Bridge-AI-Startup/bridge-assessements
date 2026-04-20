import { createWriteStream } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve, sep } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import unzipper from "unzipper";

import SubmissionModel from "../../models/submission.js";
import {
  cleanupRepoSnapshot,
  downloadAndExtractRepoSnapshot,
  type RepoSnapshotResult,
} from "../../utils/repoSnapshot.js";
import { getSubmissionCodeStorage } from "./storage.js";

const MAX_EXTRACTED_BYTES = Number(
  process.env.SUBMISSION_UPLOAD_MAX_EXTRACTED_BYTES || 300 * 1024 * 1024
);
const MAX_EXTRACTED_FILES = Number(
  process.env.SUBMISSION_UPLOAD_MAX_EXTRACTED_FILES || 20000
);

function normalizePathWithinRoot(root: string, entryPath: string): string {
  const sanitized = entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolvedPath = resolve(root, sanitized);
  const resolvedRoot = resolve(root);
  const prefix = `${resolvedRoot}${sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(prefix)) {
    throw new Error(`Unsafe zip entry path: ${entryPath}`);
  }
  return resolvedPath;
}

async function extractUploadedArchiveSafely(
  zipPath: string,
  extractDir: string
): Promise<{ repoRootPath: string }> {
  const directory = await unzipper.Open.file(zipPath);
  let totalUncompressedBytes = 0;
  let fileCount = 0;
  const topLevelDirs = new Set<string>();
  let hasRootLevelFiles = false;

  for (const entry of directory.files) {
    const entryPath = entry.path || "";
    if (!entryPath || entryPath.startsWith("__MACOSX/")) {
      continue;
    }
    const isDirectory = entry.type === "Directory";
    const outputPath = normalizePathWithinRoot(extractDir, entryPath);
    const hasNestedPath = entryPath.includes("/");
    const topLevel = entryPath.split("/").filter(Boolean)[0];
    if (hasNestedPath && topLevel) {
      topLevelDirs.add(topLevel);
    } else if (!isDirectory) {
      hasRootLevelFiles = true;
    }

    if (isDirectory) {
      await mkdir(outputPath, { recursive: true });
      continue;
    }

    fileCount += 1;
    totalUncompressedBytes += Number(entry.uncompressedSize || 0);
    if (fileCount > MAX_EXTRACTED_FILES) {
      throw new Error(
        `Archive exceeds max file count (${MAX_EXTRACTED_FILES}).`
      );
    }
    if (totalUncompressedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error(
        `Archive exceeds max extracted bytes (${MAX_EXTRACTED_BYTES}).`
      );
    }

    await mkdir(dirname(outputPath), { recursive: true });
    const readStream = entry.stream();
    const writeStream = createWriteStream(outputPath);
    await pipeline(readStream, writeStream);
  }

  let repoRootPath = extractDir;
  if (!hasRootLevelFiles && topLevelDirs.size === 1) {
    const [singleDir] = Array.from(topLevelDirs);
    repoRootPath = join(extractDir, singleDir);
  }
  return { repoRootPath };
}

export async function getSubmissionSnapshot(
  submissionId: string
): Promise<RepoSnapshotResult> {
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) {
    throw new Error("Submission not found");
  }

  if (
    submission.codeSource !== "upload" &&
    submission.githubRepo?.owner &&
    submission.githubRepo?.repo &&
    submission.githubRepo?.pinnedCommitSha
  ) {
    return downloadAndExtractRepoSnapshot({
      owner: submission.githubRepo.owner,
      repo: submission.githubRepo.repo,
      pinnedCommitSha: submission.githubRepo.pinnedCommitSha,
      submissionId: submission._id.toString(),
    });
  }

  if (
    submission.codeSource !== "upload" &&
    (!submission.githubRepo?.owner ||
      !submission.githubRepo?.repo ||
      !submission.githubRepo?.pinnedCommitSha)
  ) {
    throw new Error("GitHub repository information not found for submission.");
  }

  const storageKey = submission.codeUpload?.storageKey;
  if (!storageKey) {
    throw new Error("Uploaded code archive is missing for submission.");
  }

  const storage = getSubmissionCodeStorage();
  const archiveBuffer = await storage.readArchive(storageKey);
  if (!archiveBuffer.length) {
    throw new Error("Uploaded archive is empty.");
  }

  const baseTempDir = join(tmpdir(), "bridge-assessments");
  const sessionDir = join(
    baseTempDir,
    `${submission._id.toString()}-upload-${randomUUID()}`
  );
  const extractDir = join(sessionDir, "extract");
  const zipPath = join(sessionDir, "upload.zip");
  await mkdir(extractDir, { recursive: true });
  await mkdir(dirname(zipPath), { recursive: true });
  await writeFile(zipPath, archiveBuffer);

  try {
    const { repoRootPath } = await extractUploadedArchiveSafely(zipPath, extractDir);
    const topLevelDirName =
      repoRootPath.startsWith(`${extractDir}${sep}`)
        ? repoRootPath.slice(extractDir.length + 1)
        : "";
    return {
      repoRootPath,
      extractDir,
      zipPath,
      bytesDownloaded: archiveBuffer.length,
      topLevelDirName,
    };
  } catch (error) {
    await rm(sessionDir, { recursive: true, force: true });
    throw error;
  }
}

export { cleanupRepoSnapshot };
