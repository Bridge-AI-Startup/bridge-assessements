/**
 * GitHub Repository Snapshot Utility
 *
 * Downloads and extracts GitHub repository zipballs for analysis.
 * Handles public repos only, enforces size limits, and prevents zip slip attacks.
 */

import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { mkdir, readdir, rm } from "fs/promises";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import unzipper from "unzipper";

/**
 * Maximum allowed download size (100MB)
 */
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB in bytes

/**
 * Result of downloading and extracting a repository snapshot
 */
export interface RepoSnapshotResult {
  repoRootPath: string; // Path to the extracted repository root directory
  extractDir: string; // Path to the extraction directory
  zipPath: string; // Path to the downloaded zip file
  bytesDownloaded: number; // Number of bytes downloaded
  topLevelDirName: string; // Name of the top-level directory in the zip
}

/**
 * Parameters for downloading and extracting a repository snapshot
 */
export interface RepoSnapshotParams {
  owner: string;
  repo: string;
  pinnedCommitSha: string;
  submissionId?: string;
}

/**
 * Parameters for cleaning up a repository snapshot
 */
export interface CleanupParams {
  zipPath: string;
  extractDir: string;
}

/**
 * Builds the GitHub zipball URL for a specific commit.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param pinnedCommitSha - Commit SHA to download
 * @returns GitHub zipball URL
 */
export function buildZipballUrl(
  owner: string,
  repo: string,
  pinnedCommitSha: string
): string {
  return `https://api.github.com/repos/${owner}/${repo}/zipball/${pinnedCommitSha}`;
}

/**
 * Downloads a GitHub zipball to a temporary file.
 * Handles redirects, enforces size limits, and streams to disk.
 *
 * @param url - GitHub zipball URL
 * @param outputPath - Path where the zip file should be saved
 * @returns Number of bytes downloaded
 * @throws Error if download fails, size limit exceeded, or repo is not accessible
 */
export async function downloadZipballToFile(
  url: string,
  outputPath: string
): Promise<number> {
  let bytesDownloaded = 0;
  let finalUrl = url;

  // Fetch with redirect handling (fetch follows redirects by default)
  const response = await fetch(finalUrl, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Bridge-Assessments/1.0",
    },
    redirect: "follow", // Follow redirects automatically
  });

  // Handle HTTP errors
  if (response.status === 404) {
    throw new Error(
      "Repo not found or not public. Candidates must submit a public GitHub repo."
    );
  }

  if (response.status === 403) {
    // Check for rate limiting
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    const rateLimitReset = response.headers.get("x-ratelimit-reset");

    console.error(
      `GitHub API rate limit hit. Remaining: ${rateLimitRemaining}, Reset: ${rateLimitReset}`
    );

    throw new Error("GitHub API rate limit exceeded. Please try again later.");
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  // Check Content-Length header if available
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > MAX_DOWNLOAD_SIZE) {
      throw new Error(
        `Repository zipball exceeds maximum size of ${
          MAX_DOWNLOAD_SIZE / (1024 * 1024)
        }MB. Size: ${size / (1024 * 1024)}MB`
      );
    }
  }

  // Stream response to file with size checking
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const writeStream = createWriteStream(outputPath);

  try {
    // Use pipeline for proper streaming with error handling
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Check size limit during streaming
      bytesDownloaded += value.length;
      if (bytesDownloaded > MAX_DOWNLOAD_SIZE) {
        writeStream.destroy();
        reader.releaseLock();
        throw new Error(
          `Repository zipball exceeds maximum size of ${
            MAX_DOWNLOAD_SIZE / (1024 * 1024)
          }MB during download`
        );
      }

      // Write chunk to file
      if (!writeStream.write(value)) {
        // Wait for drain if buffer is full
        await new Promise<void>((resolve) => {
          writeStream.once("drain", resolve);
        });
      }
    }

    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    reader.releaseLock();
  } catch (error) {
    writeStream.destroy();
    throw error;
  }

  return bytesDownloaded;
}

/**
 * Safely extracts a zip file to a destination directory.
 * Implements zip slip protection by validating all entry paths.
 *
 * @param zipPath - Path to the zip file
 * @param extractDir - Directory where files should be extracted
 * @returns Name of the top-level directory in the zip
 * @throws Error if extraction fails or zip slip is detected
 */
export async function safeExtractZip(
  zipPath: string,
  extractDir: string
): Promise<string> {
  // Resolve absolute paths for comparison
  const resolvedExtractDir = resolve(extractDir);

  // Ensure extract directory exists
  await mkdir(resolvedExtractDir, { recursive: true });

  let topLevelDirName: string | null = null;

  try {
    const directory = await unzipper.Open.file(zipPath);

    // Process all entries
    for (const entry of directory.files) {
      const entryPath = entry.path;

      // Skip directories (they'll be created when files are extracted)
      if (entry.type === "Directory" || entryPath.endsWith("/")) {
        // Track top-level directory
        const parts = entryPath.split("/").filter((p) => p);
        if (parts.length > 0 && !topLevelDirName) {
          topLevelDirName = parts[0];
        }
        continue;
      }

      // Skip symlinks (safety measure - unzipper handles this, but we check type)
      if (entry.type === "SymbolicLink") {
        console.warn(`Skipping symlink: ${entryPath}`);
        continue;
      }

      // Resolve the entry path relative to extract directory
      // Normalize the path to handle any ../ or absolute paths
      const normalizedPath = entryPath
        .split("/")
        .filter((p) => p && p !== "..")
        .join("/");

      // Resolve to absolute path
      const resolvedEntryPath = resolve(resolvedExtractDir, normalizedPath);

      // Zip slip protection: ensure resolved path is within extract directory
      if (
        !resolvedEntryPath.startsWith(resolvedExtractDir + "/") &&
        resolvedEntryPath !== resolvedExtractDir
      ) {
        throw new Error(
          `Zip slip detected: entry "${entryPath}" would extract outside target directory`
        );
      }

      // Track top-level directory from file entries
      const parts = entryPath.split("/").filter((p) => p);
      if (parts.length > 0 && !topLevelDirName) {
        topLevelDirName = parts[0];
      }

      // Create parent directories
      const entryDir = dirname(resolvedEntryPath);
      await mkdir(entryDir, { recursive: true });

      // Extract file
      const writeStream = createWriteStream(resolvedEntryPath);
      await pipeline(entry.stream(), writeStream);
    }

    if (!topLevelDirName) {
      throw new Error("Could not determine top-level directory from zip file");
    }

    return topLevelDirName;
  } catch (error) {
    // Clean up on error
    try {
      await rm(resolvedExtractDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Failed to cleanup extract directory:", cleanupError);
    }
    throw error;
  }
}

/**
 * Finds the repository root directory within the extracted files.
 * GitHub zipballs typically create a single top-level directory.
 *
 * @param extractDir - Directory where the zip was extracted
 * @param topLevelDirName - Name of the top-level directory from the zip
 * @returns Absolute path to the repository root directory
 */
export function findRepoRootDir(
  extractDir: string,
  topLevelDirName: string
): string {
  const resolvedExtractDir = resolve(extractDir);
  const repoRootPath = join(resolvedExtractDir, topLevelDirName);
  return repoRootPath;
}

/**
 * Downloads and extracts a GitHub repository snapshot.
 * Creates temporary directories and files that should be cleaned up after use.
 *
 * @param params - Repository snapshot parameters
 * @returns Repository snapshot result with paths and metadata
 * @throws Error if download, extraction, or validation fails
 */
export async function downloadAndExtractRepoSnapshot(
  params: RepoSnapshotParams
): Promise<RepoSnapshotResult> {
  const { owner, repo, pinnedCommitSha, submissionId } = params;

  // Create temp directory structure
  const baseTempDir = join(tmpdir(), "bridge-assessments");
  const sessionId = submissionId || randomBytes(8).toString("hex");
  const sessionDir = join(baseTempDir, sessionId);
  const repoDirName = `${owner}-${repo}-${pinnedCommitSha.substring(0, 7)}`;
  const extractDir = join(sessionDir, repoDirName);

  await mkdir(extractDir, { recursive: true });

  // Build zipball URL
  const zipballUrl = buildZipballUrl(owner, repo, pinnedCommitSha);

  // Download zipball
  const zipFileName = `${repoDirName}.zip`;
  const zipPath = join(sessionDir, zipFileName);

  let bytesDownloaded: number;
  try {
    bytesDownloaded = await downloadZipballToFile(zipballUrl, zipPath);
  } catch (error) {
    // Clean up extract directory on download failure
    try {
      await rm(extractDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Failed to cleanup on download error:", cleanupError);
    }

    // Re-throw with context
    if (error instanceof Error) {
      // Include owner/repo/sha in logs but not user-facing message
      console.error(
        `Failed to download repo snapshot: owner=${owner}, repo=${repo}, sha=${pinnedCommitSha}`,
        error
      );
      throw error;
    }
    throw new Error(`Failed to download repository zipball: ${String(error)}`);
  }

  // Extract zip safely
  let topLevelDirName: string;
  try {
    topLevelDirName = await safeExtractZip(zipPath, extractDir);
  } catch (error) {
    // Clean up zip file on extraction failure
    try {
      await rm(zipPath, { force: true });
      await rm(extractDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Failed to cleanup on extraction error:", cleanupError);
    }

    // Re-throw with context
    if (error instanceof Error) {
      console.error(
        `Failed to extract repo snapshot: owner=${owner}, repo=${repo}, sha=${pinnedCommitSha}`,
        error
      );
      throw error;
    }
    throw new Error(`Failed to extract repository zipball: ${String(error)}`);
  }

  // Find repository root directory
  const repoRootPath = findRepoRootDir(extractDir, topLevelDirName);

  return {
    repoRootPath,
    extractDir,
    zipPath,
    bytesDownloaded,
    topLevelDirName,
  };
}

/**
 * Cleans up temporary files and directories created during snapshot download/extraction.
 * Should be called by the caller when the snapshot is no longer needed.
 *
 * @param params - Cleanup parameters with paths to remove
 * @throws Error if cleanup fails (logged but may not be critical)
 */
export async function cleanupRepoSnapshot(
  params: CleanupParams
): Promise<void> {
  const { zipPath, extractDir } = params;

  const errors: Error[] = [];

  // Remove zip file
  try {
    await rm(zipPath, { force: true });
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : new Error(`Failed to remove zip file: ${String(error)}`)
    );
  }

  // Remove extract directory
  try {
    await rm(extractDir, { recursive: true, force: true });
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error
        : new Error(`Failed to remove extract directory: ${String(error)}`)
    );
  }

  // Try to remove parent session directory if empty
  try {
    const sessionDir = dirname(extractDir);
    const sessionDirContents = await readdir(sessionDir);
    if (sessionDirContents.length === 0) {
      await rm(sessionDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore errors when trying to remove parent directory
    // It may not be empty or may have been removed already
  }

  if (errors.length > 0) {
    console.warn("Some cleanup operations failed:", errors);
    // Don't throw - cleanup failures are not critical
  }
}

/**
 * Example usage:
 *
 * ```typescript
 * import {
 *   downloadAndExtractRepoSnapshot,
 *   cleanupRepoSnapshot,
 * } from "./util/repoSnapshot.js";
 *
 * // Download and extract a repository
 * const snapshot = await downloadAndExtractRepoSnapshot({
 *   owner: "facebook",
 *   repo: "react",
 *   pinnedCommitSha: "abc123def456",
 *   submissionId: "submission-123", // Optional
 * });
 *
 * console.log(`Repository extracted to: ${snapshot.repoRootPath}`);
 * console.log(`Downloaded ${snapshot.bytesDownloaded} bytes`);
 *
 * // ... perform analysis on snapshot.repoRootPath ...
 *
 * // Clean up when done
 * await cleanupRepoSnapshot({
 *   zipPath: snapshot.zipPath,
 *   extractDir: snapshot.extractDir,
 * });
 * ```
 */
