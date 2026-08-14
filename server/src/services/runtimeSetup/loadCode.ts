import type { Sandbox } from "e2b";
import { getSubmissionCodeStorage } from "../submissionCode/storage.js";
import type { RuntimeSandboxContext } from "./sandbox.js";

/**
 * Load the candidate's submitted snapshot into the sandbox (upload zip or git clone).
 * Mirrors behavioralGrading/index.ts cloneAndCheckout so we do not run on the host.
 */
export async function loadSubmissionCodeIntoSandbox(
  ctx: RuntimeSandboxContext,
  submission: {
    _id: { toString(): string };
    codeSource?: string;
    codeUpload?: { storageKey?: string | null };
    githubRepo?: {
      owner?: string | null;
      repo?: string | null;
      pinnedCommitSha?: string | null;
    };
  }
): Promise<string> {
  const repoPath = `/tmp/submission-${submission._id.toString()}`;
  const sandbox = ctx.sandbox as Sandbox;

  if (submission.codeSource === "upload") {
    const storageKey = submission.codeUpload?.storageKey;
    if (!storageKey) {
      throw new Error("Submission archive metadata is missing.");
    }
    const archiveStorage = getSubmissionCodeStorage();
    const archive = await archiveStorage.readArchive(storageKey);
    const archivePath = `${repoPath}.zip`;
    await sandbox.files.write(archivePath, archive);

    const ensureRepoDir = await ctx.run(`mkdir -p ${repoPath}`, {
      timeoutMs: 15_000,
    });
    if (ensureRepoDir.exitCode !== 0) {
      throw new Error(
        `Failed to prepare repo directory: ${ensureRepoDir.stderr || "unknown error"}`
      );
    }

    const unzip = await ctx.run(`unzip -q ${archivePath} -d ${repoPath}`, {
      timeoutMs: 180_000,
    });
    if (unzip.exitCode !== 0) {
      throw new Error(
        `Failed to extract uploaded archive: ${unzip.stderr || "unknown error"}`
      );
    }
    const resolveRoot = await ctx.run(
      `bash -lc 'shopt -s nullglob dotglob; entries=(${repoPath}/*); if [ "\${#entries[@]}" -eq 1 ] && [ -d "\${entries[0]}" ]; then printf "%s" "\${entries[0]}"; else printf "%s" "${repoPath}"; fi'`,
      { timeoutMs: 15_000 }
    );
    if (resolveRoot.exitCode === 0 && resolveRoot.stdout?.trim()) {
      return resolveRoot.stdout.trim();
    }
    return repoPath;
  }

  const owner = submission.githubRepo?.owner;
  const repo = submission.githubRepo?.repo;
  if (!owner || !repo) {
    throw new Error("GitHub repository information not found for submission.");
  }
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const clone = await ctx.run(`git clone ${cloneUrl} ${repoPath}`, {
    timeoutMs: 180_000,
  });
  if (clone.exitCode !== 0) {
    throw new Error(`Failed to clone repository: ${clone.stderr || "unknown error"}`);
  }

  const sha = submission.githubRepo?.pinnedCommitSha;
  if (sha) {
    const checkout = await ctx.run(`git checkout ${sha}`, {
      cwd: repoPath,
      timeoutMs: 60_000,
    });
    if (checkout.exitCode !== 0) {
      throw new Error(
        `Failed to checkout pinned commit: ${checkout.stderr || "unknown error"}`
      );
    }
  }

  return repoPath;
}
