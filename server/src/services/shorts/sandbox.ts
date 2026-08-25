/**
 * Play E2B sandboxes — long-lived user build environments (static preview + Claude).
 * Separate from grading's withGradingSandbox (which always kills after one fn).
 */
import { Sandbox } from "e2b";
import {
  getE2bApiKeyOrThrow,
  runCommand,
} from "../e2b/graderSandbox.js";
import { shortsEnv } from "../../utils/shortsEnv.js";

export const PLAY_PREVIEW_PORT = 8080;
export const PLAY_WORKSPACE = "/home/user/project";

const DEFAULT_PLAY_TEMPLATE = "bridge-play-dev";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export type PlaySandboxUrls = {
  previewUrl: string;
};

export type CreatePlaySandboxOptions = {
  /** E2B template name/id. Defaults to PLAY_E2B_TEMPLATE_ID or bridge-play-dev. */
  templateId?: string;
  /** Max continuous running lifetime in ms (E2B Hobby max 1h). */
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export function getPlayE2bTemplateId(): string {
  return shortsEnv(
    "SHORTS_E2B_TEMPLATE_ID",
    "PLAY_E2B_TEMPLATE_ID",
    DEFAULT_PLAY_TEMPLATE,
  );
}

/**
 * Create a Play sandbox from the custom template.
 * Uses lifecycle.onTimeout=pause so idle/timeout preserves the box for later resume.
 */
export async function createPlaySandbox(
  options: CreatePlaySandboxOptions = {},
): Promise<Sandbox> {
  getE2bApiKeyOrThrow();

  const template = options.templateId ?? getPlayE2bTemplateId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return Sandbox.create(template, {
    timeoutMs,
    metadata: options.metadata,
    lifecycle: {
      onTimeout: "pause",
    },
  });
}

export function getPlaySandboxUrls(sandbox: Sandbox): PlaySandboxUrls {
  const previewHost = sandbox.getHost(PLAY_PREVIEW_PORT);
  return { previewUrl: `https://${previewHost}/` };
}

export async function killPlaySandbox(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.kill();
  } catch (err) {
    console.error(
      `[play/sandbox] Failed to kill sandbox ${sandbox.sandboxId}:`,
      err,
    );
  }
}

/** Pause by id (no-op if already paused). Returns false if not found / gone. */
export async function pausePlaySandbox(sandboxId: string): Promise<boolean> {
  getE2bApiKeyOrThrow();
  try {
    return await Sandbox.pause(sandboxId);
  } catch (err) {
    console.warn(
      `[play/sandbox] pause failed for ${sandboxId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Connect to a running or paused sandbox (resumes if paused) and reset TTL.
 */
export async function connectPlaySandbox(
  sandboxId: string,
  opts?: { timeoutMs?: number },
): Promise<Sandbox> {
  getE2bApiKeyOrThrow();
  return Sandbox.connect(sandboxId, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

/** Appended to every session CHALLENGE.md so Claude + humans know preview rules. */
export const PLAY_PREVIEW_CONSTRAINTS = [
  "## Preview rules (required)",
  "",
  "- The live preview serves this folder with a **static** file server.",
  "- **Entry page is always `index.html`.** Preview opens that file first.",
  "- Put the home/start UI in `index.html` (plus linked `style.css` / `main.js`, or CDN).",
  "- **Multi-page is OK:** you may add `about.html`, `detail.html`, etc., as long as users can reach them via links from `index.html` (or from each other).",
  "- Do **not** leave `index.html` as an empty redirect stub or untouched starter while the real app lives only in another file with no link from the entry.",
  "- **No Vite / npm build / Next / CRA** — they will not run in Preview.",
  "- Vanilla JS or a CDN framework only. Prefer `preventDefault` on forms and `localStorage` when the challenge asks for persistence.",
].join("\n");

/**
 * Project `CLAUDE.md` — Claude Code loads this automatically from the workspace.
 * Keep short and imperative so first-turn builds target index.html as entry.
 */
export const PLAY_PROJECT_CLAUDE_MD = [
  "# Bridge Play workspace",
  "",
  "You are building inside `/home/user/project` for a timed consumer challenge.",
  "",
  "## Non-negotiable",
  "",
  "1. **Preview opens `index.html` first.** That file is the home/entry page.",
  "2. **Always build a real home UI into `index.html`** (and `style.css` / `main.js` as needed). Replace the starter markup.",
  "3. **Extra HTML pages are allowed** for multi-page apps — link them from `index.html` (e.g. `<a href=\"detail.html\">`). Users can open those URLs in Preview.",
  "4. Do **not** put the whole app only in a new HTML file while leaving `index.html` as the untouched starter.",
  "5. Read `CHALLENGE.md` for the brief. Static preview only — no Vite, npm install, or bundlers.",
  "6. Prefer vanilla JS or CDN frameworks; use `localStorage` when persistence is required.",
  "",
  "## How you work (critical)",
  "",
  "- You **cannot** see the user's Preview iframe or browser DevTools. **Never** ask them to open the console, press F12, or report log output.",
  "- If something seems broken: **read the files, fix the code, and ship a simpler correct version.** Do not add console.debug scavenger hunts.",
  "- Prefer a short, working implementation over elaborate debugging.",
  "- Common bugs for todos / forms: missing `event.preventDefault()` on submit, listeners before DOM ready, wrong element ids, overwriting `innerHTML` and wiping inputs.",
  "- `localStorage` works inside the Preview origin. After you edit files, Preview may reload — that is normal; persisted data should still load on startup if you read/write the same key.",
  "",
].join("\n");

/**
 * Write the current round's challenge into the workspace (session + smoke).
 * Always includes preview constraints so Claude targets `index.html`.
 */
export async function writeChallengeMarkdown(
  sandbox: Sandbox,
  prompt: string,
): Promise<void> {
  const path = `${PLAY_WORKSPACE}/CHALLENGE.md`;
  const body = String(prompt || "").trimEnd();
  const withRules = body.includes("## Preview rules")
    ? `${body}\n`
    : `${body}\n\n${PLAY_PREVIEW_CONSTRAINTS}\n`;
  await sandbox.files.write(path, withRules);
}

/** Write / refresh project CLAUDE.md (auto-read by Claude Code). */
export async function writePlayProjectClaudeMd(
  sandbox: Sandbox,
): Promise<void> {
  await sandbox.files.write(
    `${PLAY_WORKSPACE}/CLAUDE.md`,
    PLAY_PROJECT_CLAUDE_MD,
  );
}

/**
 * Run a shell command in a Play sandbox (non-throwing on non-zero exit).
 */
export async function runPlayCommand(
  sandbox: Sandbox,
  cmd: string,
  opts?: Parameters<typeof runCommand>[2],
) {
  return runCommand(sandbox, cmd, opts);
}

/**
 * Content fingerprint of the project workspace (mtime + size per file).
 * Used to refresh the preview iframe only when files change (e.g. after save).
 */
export async function getWorkspaceRevision(
  sandbox: Sandbox,
): Promise<string> {
  const cmd = [
    `cd ${PLAY_WORKSPACE}`,
    `&& find . -type f`,
    `! -path '*/node_modules/*'`,
    `! -path '*/.git/*'`,
    `! -path '*/.claude/*'`,
    `| sort`,
    `| xargs -r stat -c '%n %Y %s' 2>/dev/null`,
    `| md5sum`,
    `| awk '{print $1}'`,
  ].join(" ");

  const result = await runPlayCommand(sandbox, cmd, { timeoutMs: 15_000 });
  const rev = (result.stdout || "").trim().split(/\s+/)[0];
  return rev || "0";
}

export type SnapshotFile = {
  path: string;
  content: string;
};

export type SnapshotProjectResult = {
  files: SnapshotFile[];
  totalBytes: number;
};

const SNAPSHOT_MAX_FILES = 100;
const SNAPSHOT_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024; // 1.5 MB
const SNAPSHOT_MAX_FILE_BYTES = 200 * 1024; // 200 KB

/** Never persist sandbox secrets / Claude session config into snapshots. */
export const PLAY_SNAPSHOT_SKIP_DIR_PATTERN =
  /(^|\/)(node_modules|\.git|\.claude)(\/|$)/;

/** Strip paths that must never leave the sandbox (e.g. public submission APIs). */
export function filterPlayPublicFiles<T extends { path: string }>(
  files: T[] | null | undefined,
): T[] {
  return (files || []).filter(
    (f) => f?.path && !PLAY_SNAPSHOT_SKIP_DIR_PATTERN.test(f.path),
  );
}

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
 * Snapshot text files under PLAY_WORKSPACE for submission persistence.
 */
export async function snapshotProjectFiles(
  sandbox: Sandbox,
): Promise<SnapshotProjectResult> {
  const listCmd = [
    `cd ${PLAY_WORKSPACE}`,
    `&& find . -maxdepth 8 -type f`,
    `! -path '*/node_modules/*'`,
    `! -path '*/.git/*'`,
    `! -path '*/.claude/*'`,
    `| head -n ${SNAPSHOT_MAX_FILES + 20}`,
  ].join(" ");

  const listed = await runPlayCommand(sandbox, listCmd, {
    timeoutMs: 30_000,
  });
  if (listed.exitCode !== 0) {
    throw new Error(
      `Failed to list project files: ${listed.stderr || listed.stdout || "unknown"}`,
    );
  }

  const relativePaths = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("./") ? p.slice(2) : p.replace(/^\.\//, "")))
    .filter((p) => p && !PLAY_SNAPSHOT_SKIP_DIR_PATTERN.test(p));

  if (relativePaths.length === 0) {
    throw new Error("Project snapshot is empty");
  }
  if (relativePaths.length > SNAPSHOT_MAX_FILES) {
    throw new Error(
      `Project has too many files (max ${SNAPSHOT_MAX_FILES})`,
    );
  }

  const files: SnapshotFile[] = [];
  let totalBytes = 0;

  for (const rel of relativePaths) {
    const abs = `${PLAY_WORKSPACE}/${rel}`;
    let content: string;
    try {
      content = await sandbox.files.read(abs);
    } catch (err) {
      console.warn(`[play/sandbox] skip unreadable file ${rel}:`, err);
      continue;
    }
    if (typeof content !== "string") {
      continue;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > SNAPSHOT_MAX_FILE_BYTES) {
      continue;
    }
    if (looksBinary(content)) {
      continue;
    }
    if (totalBytes + bytes > SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error(
        `Project snapshot exceeds ${Math.round(SNAPSHOT_MAX_TOTAL_BYTES / 1024)}KB`,
      );
    }
    files.push({ path: rel, content });
    totalBytes += bytes;
  }

  if (files.length === 0) {
    throw new Error("No readable text files found in project");
  }

  return { files, totalBytes };
}
