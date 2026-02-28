/**
 * GitHub Repository Utility
 *
 * Parses GitHub repository URLs and resolves pinned commit SHAs.
 * This utility ensures we can track specific commits for assessment submissions.
 */

/**
 * Parsed repository information from a GitHub URL
 */
export interface ParsedRepo {
  owner: string;
  repo: string;
  refType?: "commit" | "branch";
  ref?: string;
}

/**
 * Normalized repository information with pinned commit SHA
 */
export interface ResolvedRepo {
  owner: string;
  repo: string;
  refType: "commit" | "branch";
  ref: string;
  pinnedCommitSha: string;
}

/**
 * GitHub API repository metadata response
 */
interface GitHubRepoResponse {
  private: boolean;
  default_branch: string;
  full_name: string;
}

/**
 * GitHub API commit response
 */
interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
  };
}

/**
 * Parses a GitHub repository URL and extracts owner, repo, and optional ref.
 *
 * Supports URLs in the following formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/commit/sha
 * - http://github.com/owner/repo (without https)
 * - https://www.github.com/owner/repo (with www)
 *
 * @param url - The GitHub repository URL to parse
 * @returns Parsed repository information
 * @throws Error if the URL is invalid or cannot be parsed
 */
export function parseGithubRepoUrl(url: string): ParsedRepo {
  // Normalize the URL: remove www, ensure https, trim whitespace
  const normalizedUrl = url
    .trim()
    .replace(/^http:\/\//, "https://")
    .replace(/^https:\/\/www\./, "https://");

  // Match GitHub URL patterns
  // Pattern 1: /commit/{sha} - specific commit
  const commitMatch = normalizedUrl.match(
    /^https:\/\/github\.com\/([\w\-\.]+)\/([\w\-\.]+)\/commit\/([\w]+)/
  );
  if (commitMatch) {
    return {
      owner: commitMatch[1],
      repo: commitMatch[2],
      refType: "commit",
      ref: commitMatch[3],
    };
  }

  // Pattern 2: /tree/{branch} - specific branch
  const branchMatch = normalizedUrl.match(
    /^https:\/\/github\.com\/([\w\-\.]+)\/([\w\-\.]+)\/tree\/([\w\-\.\/]+)/
  );
  if (branchMatch) {
    return {
      owner: branchMatch[1],
      repo: branchMatch[2],
      refType: "branch",
      ref: branchMatch[3],
    };
  }

  // Pattern 3: base repository URL - no ref specified
  const baseMatch = normalizedUrl.match(
    /^https:\/\/github\.com\/([\w\-\.]+)\/([\w\-\.]+)(?:\/)?$/
  );
  if (baseMatch) {
    return {
      owner: baseMatch[1],
      repo: baseMatch[2],
    };
  }

  // If no pattern matches, throw an error
  throw new Error("Invalid GitHub repository URL format");
}

/**
 * Fetches repository metadata from GitHub API.
 * Verifies the repository is public and retrieves the default branch.
 *
 * @param owner - Repository owner username
 * @param repo - Repository name
 * @returns Repository metadata including default branch and privacy status
 * @throws Error if the repository is private or cannot be accessed
 */
async function fetchRepoMetadata(
  owner: string,
  repo: string
): Promise<GitHubRepoResponse> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Bridge-Assessments/1.0",
      },
    });

    // Handle HTTP errors
    if (response.status === 404) {
      throw new Error("Repository not found");
    }

    if (response.status === 403) {
      throw new Error("GitHub API rate limit exceeded or access forbidden");
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    const data: GitHubRepoResponse = await response.json();

    // Verify repository is public (hard requirement)
    if (data.private === true) {
      throw new Error(
        "Repository must be public. Please make the repo public and resubmit."
      );
    }

    return data;
  } catch (error) {
    // Re-throw our custom errors as-is
    if (
      error instanceof Error &&
      error.message.includes("Repository must be public")
    ) {
      throw error;
    }
    if (
      error instanceof Error &&
      error.message.includes("Repository not found")
    ) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("GitHub API")) {
      throw error;
    }
    // Wrap other errors (network errors, JSON parsing, etc.)
    throw new Error(
      `Failed to fetch repository metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Resolves a branch name to its latest commit SHA.
 *
 * @param owner - Repository owner username
 * @param repo - Repository name
 * @param branch - Branch name to resolve
 * @returns The latest commit SHA for the branch
 * @throws Error if the branch cannot be found or accessed
 */
async function resolveBranchToCommit(
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(
    branch
  )}&per_page=1`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Bridge-Assessments/1.0",
      },
    });

    if (response.status === 404) {
      throw new Error(`Branch '${branch}' not found`);
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    const commits: GitHubCommitResponse[] = await response.json();

    if (!commits || commits.length === 0) {
      throw new Error(`No commits found for branch '${branch}'`);
    }

    return commits[0].sha;
  } catch (error) {
    // Re-throw our custom errors as-is
    if (error instanceof Error && error.message.includes("Branch")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("GitHub API")) {
      throw error;
    }
    // Wrap other errors
    throw new Error(
      `Failed to resolve branch to commit: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Resolves and pins a commit SHA for a GitHub repository.
 *
 * This function:
 * 1. Fetches repository metadata to verify it's public and get the default branch
 * 2. Resolves the commit SHA based on the URL pattern:
 *    - If URL contains /commit/{sha}, uses that SHA directly
 *    - If URL contains /tree/{branch}, resolves that branch to its latest commit SHA
 *    - If no ref is provided, resolves the default branch to its latest commit SHA
 *
 * @param parsedRepo - Parsed repository information from parseGithubRepoUrl
 * @returns Normalized repository information with pinned commit SHA
 * @throws Error if the repository is private, not found, or cannot be accessed
 */
export async function resolvePinnedCommit(
  parsedRepo: ParsedRepo
): Promise<ResolvedRepo> {
  const { owner, repo, refType, ref } = parsedRepo;

  // Step 1: Fetch repository metadata
  // This verifies the repo exists, is public, and gives us the default branch
  const repoMetadata = await fetchRepoMetadata(owner, repo);

  // Step 2: Determine the ref type and resolve the commit SHA
  let finalRefType: "commit" | "branch";
  let finalRef: string;
  let pinnedCommitSha: string;

  if (refType === "commit" && ref) {
    // Case 1: URL contains /commit/{sha} - use it directly
    // We still verify the commit exists by trying to resolve it
    finalRefType = "commit";
    finalRef = ref;
    pinnedCommitSha = ref;

    // Verify the commit exists by fetching it
    try {
      const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;
      const commitResponse = await fetch(commitUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Bridge-Assessments/1.0",
        },
      });

      if (commitResponse.status === 404) {
        throw new Error(`Commit '${ref}' not found in repository`);
      }

      if (!commitResponse.ok) {
        throw new Error(
          `GitHub API error: ${commitResponse.status} ${commitResponse.statusText}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Commit")) {
        throw error;
      }
      throw new Error(
        `Failed to verify commit: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else if (refType === "branch" && ref) {
    // Case 2: URL contains /tree/{branch} - resolve branch to commit SHA
    finalRefType = "branch";
    finalRef = ref;
    pinnedCommitSha = await resolveBranchToCommit(owner, repo, ref);
  } else {
    // Case 3: No ref provided - use default branch and resolve to commit SHA
    // We don't assume the default branch is "main" - we use what GitHub tells us
    const defaultBranch = repoMetadata.default_branch;
    finalRefType = "branch";
    finalRef = defaultBranch;
    pinnedCommitSha = await resolveBranchToCommit(owner, repo, defaultBranch);
  }

  return {
    owner,
    repo,
    refType: finalRefType,
    ref: finalRef,
    pinnedCommitSha,
  };
}

/**
 * Example usage:
 *
 * ```typescript
 * // Example 1: URL with specific commit
 * const parsed1 = parseGithubRepoUrl("https://github.com/facebook/react/commit/abc123def456");
 * const resolved1 = await resolvePinnedCommit(parsed1);
 * // Returns: {
 * //   owner: "facebook",
 * //   repo: "react",
 * //   refType: "commit",
 * //   ref: "abc123def456",
 * //   pinnedCommitSha: "abc123def456"
 * // }
 *
 * // Example 2: URL with branch
 * const parsed2 = parseGithubRepoUrl("https://github.com/facebook/react/tree/main");
 * const resolved2 = await resolvePinnedCommit(parsed2);
 * // Returns: {
 * //   owner: "facebook",
 * //   repo: "react",
 * //   refType: "branch",
 * //   ref: "main",
 * //   pinnedCommitSha: "latest_commit_sha_for_main"
 * // }
 *
 * // Example 3: Base repository URL (no ref)
 * const parsed3 = parseGithubRepoUrl("https://github.com/facebook/react");
 * const resolved3 = await resolvePinnedCommit(parsed3);
 * // Returns: {
 * //   owner: "facebook",
 * //   repo: "react",
 * //   refType: "branch",
 * //   ref: "main" (or whatever the default branch is),
 * //   pinnedCommitSha: "latest_commit_sha_for_default_branch"
 * // }
 * ```
 */
