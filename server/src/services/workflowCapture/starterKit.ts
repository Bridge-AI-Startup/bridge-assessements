/**
 * Ship the capture kit with the candidate's starter files.
 *
 * Injected at delivery rather than copied into each assessment's
 * `starterCodeFiles`, for two reasons: assessments created before this existed
 * would otherwise never get it, and — more importantly — stored copies go stale.
 * We were bitten by exactly that during development: a `.bridge/` folder set up
 * before a fix kept running the buggy script. Reading from disk per request
 * means every candidate always gets the current kit.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface StarterFile {
  path: string;
  content: string;
}

/**
 * Files the candidate needs. README included so the disclosure travels too.
 *
 * `package.json` is load-bearing: it pins `"type": "commonjs"`. Without it,
 * `node capture-kit/setup.js` fails inside any starter whose root
 * package.json has `"type": "module"` (Node then treats every `.js` file as
 * ESM, and the kit's `require()` calls throw).
 */
const KIT_FILES = [
  "setup.js",
  "bridge-capture.js",
  "cursor-adapter.js",
  "codex-adapter.js",
  "view.js",
  "README.md",
  "package.json",
  "sessionClosed.js",
];

function resolveKitDir(): string | null {
  const candidates: string[] = [];
  try {
    // server/src/services/workflowCapture/ → repo root
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "../../../../capture-kit"));
  } catch {
    /* non-ESM context */
  }
  // Running from server/ (npm run dev) or the repo root.
  candidates.push(path.resolve(process.cwd(), "../capture-kit"));
  candidates.push(path.resolve(process.cwd(), "capture-kit"));

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "setup.js"))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

let cached: StarterFile[] | null = null;

/**
 * The capture kit as starter files, under a `capture-kit/` prefix so the
 * command shown to the candidate (`node capture-kit/setup.js <token>`) works
 * from the root of the unzipped starter project.
 *
 * Cached after first read: these do not change while the server is running, and
 * this sits in the path of every candidate page load.
 */
export function getCaptureKitStarterFiles(): StarterFile[] {
  if (cached) return cached;

  const dir = resolveKitDir();
  if (!dir) {
    console.warn(
      "[capture-kit] could not locate capture-kit/ on disk; candidates will not receive it with their starter files"
    );
    cached = [];
    return cached;
  }

  const files: StarterFile[] = [];
  for (const name of KIT_FILES) {
    try {
      files.push({
        path: `capture-kit/${name}`,
        content: fs.readFileSync(path.join(dir, name), "utf8"),
      });
    } catch {
      // A missing optional file (e.g. an adapter removed later) must not stop
      // the candidate receiving the rest of the kit.
    }
  }
  cached = files;
  return cached;
}

/**
 * Merge the kit into an assessment's starter files.
 * Existing files win: if an employer has deliberately shipped their own
 * `capture-kit/` we do not overwrite it.
 */
export function withCaptureKit(
  starterCodeFiles: StarterFile[] | undefined | null
): StarterFile[] {
  const existing = Array.isArray(starterCodeFiles) ? starterCodeFiles : [];
  const taken = new Set(existing.map((f) => f.path));
  const kit = getCaptureKitStarterFiles().filter((f) => !taken.has(f.path));
  return [...existing, ...kit];
}
