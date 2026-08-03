/**
 * Detect near-empty / unchanged Play starter projects so submit can reject them.
 *
 * Starter copy must stay in sync with `shorts/e2b-template/starter-project/`.
 */

export const STARTER_ONLY_CODE = "starter_only" as const;

export const STARTER_ONLY_MESSAGE =
  "Build something first — your project still looks like the unchanged starter.";

/** Embedded from shorts/e2b-template/starter-project (post code-server removal). */
export const STARTER_FILES: Record<string, string> = {
  "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bridge Shorts</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <p class="eyebrow">Preview</p>
      <h1>Nothing here yet — and that's normal.</h1>
      <p class="lede">
        Whatever you build will show up right here. It's blank because you
        haven't asked for anything yet.
      </p>
      <ol>
        <li>
          <strong>Read the challenge.</strong>
          It's at the top of the chat — that's what you're making today.
        </li>
        <li>
          <strong>Describe what you want in the chat, in plain English.</strong>
          Something like "a dice roller with one big red button" is enough to
          start.
        </li>
        <li>
          <strong>Watch this panel.</strong>
          It refreshes every time your build changes. Don't like it? Say what to
          change and ask again — as many times as you want.
        </li>
        <li>
          <strong>Press Submit when you're happy with it.</strong>
          Then go vote on what everyone else made.
        </li>
      </ol>
      <p class="hint">
        No coding needed. Keep an eye on <strong>Time left</strong> at the top —
        when it runs out, so does the round.
      </p>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`,
  "style.css": `:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5;
  color: #0f172a;
  background: #f8fafc;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

main {
  max-width: 32rem;
  width: 100%;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem 1.75rem;
}

h1 {
  margin: 0 0 0.75rem;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

p {
  margin: 0 0 0.75rem;
  color: #334155;
}

.eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.lede {
  margin-bottom: 1.25rem;
}

ol {
  margin: 0 0 1.25rem;
  padding-left: 1.25rem;
  color: #334155;
}

li {
  margin-bottom: 0.75rem;
}

li:last-child {
  margin-bottom: 0;
}

li strong {
  color: #0f172a;
}

.hint {
  margin-bottom: 0;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  font-size: 0.9rem;
  color: #64748b;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
`,
  "main.js": `console.log("Bridge Play starter ready. Build your challenge in this project.");
`,
  "README.md": `# Bridge Play starter

Static HTML/CSS/JS project for daily challenges.

## How to work

1. Open \`CHALLENGE.md\` when it appears (injected per session).
2. Edit **\`index.html\` in place** — Preview opens that file first. Use \`style.css\` / \`main.js\` as needed.
3. Multi-page is OK: add more \`.html\` files and link them from \`index.html\`.
4. Watch the **Preview** pane — static server, opens \`index.html\` by default.
5. Use the **Claude** chat panel to build or iterate.

## Constraints (v1)

- **Entry = \`index.html\`.** That is the home page users land on.
- Extra HTML pages are allowed when linked from the entry (or each other).
- Vanilla JS or CDN frameworks only — no Vite, npm build, Next, or CRA.
- Keep everything in this folder so the static preview server can serve it.
`,
};

/**
 * Older starter copy that live snapshots may still hold. Sessions created before
 * a starter rewrite keep the previous files in `workspaceSnapshot`, so every
 * shipped variant must stay comparable or those builds sail past the submit gate.
 */
const LEGACY_STARTER_FILES: Record<string, string[]> = {
  "index.html": [
    // Plain-language rewrite predecessor (post code-server removal).
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bridge Play</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Bridge Play</h1>
      <p>
        Open <code>CHALLENGE.md</code>, then build your solution in
        <strong>this</strong> <code>index.html</code> (Preview only loads this
        file).
      </p>
      <p class="hint">
        Tip: chat with Claude in the chat panel to build this.
      </p>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`,
  ],
  "style.css": [
    `:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5;
  color: #0f172a;
  background: #f8fafc;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

main {
  max-width: 32rem;
  width: 100%;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem 1.75rem;
}

h1 {
  margin: 0 0 0.75rem;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

p {
  margin: 0 0 0.75rem;
  color: #334155;
}

.hint {
  margin-bottom: 0;
  font-size: 0.9rem;
  color: #64748b;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
`,
  ],
};

/** Current + every shipped legacy version of a starter file. */
function starterVariants(path: string): string[] {
  const current = STARTER_FILES[path];
  return [
    ...(current != null ? [current] : []),
    ...(LEGACY_STARTER_FILES[path] ?? []),
  ];
}

/** Injected per session — ignore when comparing to starter. */
const IGNORED_PATHS = new Set([
  "challenge.md",
  "claude.md",
  "claude_play.md",
  "readme.md",
  ".ds_store",
  ".gitignore",
]);

/** Phrases that uniquely mark the default starter index.html / main.js. */
const STARTER_INDEX_PHRASES = [
  "<title>bridge shorts</title>",
  "nothing here yet — and that's normal",
  "describe what you want in the chat, in plain english",
  "no coding needed. keep an eye on",
  // Pre-plain-language-rewrite starter copy — keep so older snapshots still match.
  "open challenge.md when present, then build your solution",
  "build your solution in this index.html",
  "preview only loads this",
  "tip: chat with claude in the chat panel to build this",
  // Pre-Monaco-removal starter copy — keep so older snapshots still match.
  "tip: edit files in the monaco editor, or ask claude in the chat panel",
  "<title>bridge play</title>",
];

const MIN_INDEX_CHARS = 80;
/** Max relative length delta still considered “same size” as starter. */
const LENGTH_TOLERANCE = 0.3;
/** Max fraction of differing normalized chars for “near-identical”. */
const NEAR_IDENTICAL_DISTANCE = 0.12;

export class StarterOnlyError extends Error {
  readonly statusCode = 400;
  readonly code = STARTER_ONLY_CODE;

  constructor(message = STARTER_ONLY_MESSAGE) {
    super(message);
    this.name = "StarterOnlyError";
  }
}

export function isStarterOnlyError(err: unknown): err is StarterOnlyError {
  return err instanceof StarterOnlyError;
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/").trim();
}

function stripComments(content: string, path: string): string {
  const lower = path.toLowerCase();
  let s = content;
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    s = s.replace(/<!--[\s\S]*?-->/g, "");
  }
  if (lower.endsWith(".js") || lower.endsWith(".css") || lower.endsWith(".html")) {
    s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  }
  if (lower.endsWith(".js")) {
    s = s.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }
  return s;
}

function normalizeContent(content: string, path = ""): string {
  return stripComments(content, path)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim()
    .toLowerCase();
}

/**
 * Bounded Levenshtein distance / max(len) — enough for small starter files.
 * Caps work when strings are very long by early-exit on length mismatch.
 */
function relativeEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  if (Math.abs(a.length - b.length) / maxLen > NEAR_IDENTICAL_DISTANCE * 2) {
    return 1;
  }
  // Cap compare window — starters are tiny; truncate rare oversized diffs.
  const limit = 4000;
  const aa = a.length > limit ? a.slice(0, limit) : a;
  const bb = b.length > limit ? b.slice(0, limit) : b;
  const m = aa.length;
  const n = bb.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n] / Math.max(m, n, 1);
}

function isNearIdentical(user: string, starter: string, path: string): boolean {
  const a = normalizeContent(user, path);
  const b = normalizeContent(starter, path);
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const lenRatio =
    Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1);
  if (lenRatio > LENGTH_TOLERANCE) return false;
  return relativeEditDistance(a, b) <= NEAR_IDENTICAL_DISTANCE;
}

function countStarterPhrases(normalizedIndex: string): number {
  let n = 0;
  for (const phrase of STARTER_INDEX_PHRASES) {
    if (normalizedIndex.includes(phrase)) n += 1;
  }
  return n;
}

/**
 * True when index.html is missing, tiny, or still essentially the starter shell.
 * Rewritten bodies (e.g. a counter widget) that drop starter copy → false.
 */
export function isIndexHtmlStarterLike(content: string | undefined): boolean {
  if (content == null) return true;
  const normalized = normalizeContent(content, "index.html");
  if (normalized.length < MIN_INDEX_CHARS) return true;

  const phrases = countStarterPhrases(normalized);

  // Compare against every shipped starter — older sessions still hold old copy.
  for (const variant of starterVariants("index.html")) {
    const starterNorm = normalizeContent(variant, "index.html");
    if (normalized === starterNorm) return true;

    const lenRatio =
      Math.abs(normalized.length - starterNorm.length) /
      Math.max(starterNorm.length, 1);

    // Still has distinctive starter copy and roughly the same size → starter-like
    // unless the body actually diverged (edit distance).
    if (phrases >= 2 && lenRatio <= LENGTH_TOLERANCE) {
      if (isNearIdentical(content, variant, "index.html")) return true;
      continue;
    }

    // Exact title + tip copy still present and very close → reject whitespace/comment-only edits
    if (phrases >= 2 && relativeEditDistance(normalized, starterNorm) <= 0.2) {
      return true;
    }
  }

  return false;
}

function isIgnorablePath(path: string): boolean {
  const base = normalizePath(path).split("/").pop()?.toLowerCase() ?? "";
  if (IGNORED_PATHS.has(base)) return true;
  if (base.startsWith(".")) return true;
  return false;
}

/**
 * Returns true if the snapshot is empty of real work (starter-only / near-empty).
 */
export function isStarterOnlySubmission(
  files: Array<{ path: string; content: string }>,
): boolean {
  const byPath = new Map<string, string>();
  for (const f of files) {
    const p = normalizePath(f.path);
    if (!p || isIgnorablePath(p)) continue;
    byPath.set(p, f.content ?? "");
  }

  const indexContent =
    byPath.get("index.html") ?? byPath.get("index.htm");

  // Primary gate: meaningful index.html that is not the starter shell.
  if (!isIndexHtmlStarterLike(indexContent)) {
    return false;
  }

  // index is starter-like (or missing). Allow if another file has real work
  // (rewritten main.js / new assets); otherwise treat as starter-only.
  for (const [path, content] of byPath) {
    const base = path.split("/").pop() ?? path;
    if (base === "index.html" || base === "index.htm") continue;

    const variants = starterVariants(base);
    if (variants.length) {
      if (
        normalizeContent(content, base).length >= 40 &&
        !variants.some((starter) => isNearIdentical(content, starter, base))
      ) {
        return false;
      }
      continue;
    }

    if (normalizeContent(content, path).length >= 40) {
      return false;
    }
  }

  return true;
}

export function assertNotStarterOnly(
  files: Array<{ path: string; content: string }>,
): void {
  if (isStarterOnlySubmission(files)) {
    throw new StarterOnlyError();
  }
}
