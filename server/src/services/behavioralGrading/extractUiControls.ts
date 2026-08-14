/**
 * Source-grounded UI control catalog.
 *
 * Playwright is the hands: it clicks and fills locators we already derived from
 * the candidate repo. The live page is not a search index — a paragraph that
 * happens to contain "Add" is not a button, even if `getByText("Add")` would
 * hit it first.
 *
 * Heuristic extractors, not a compiler. Assessments are stack-agnostic and this
 * repo has no tree-sitter. Native `<button>` / `<input>` / `<a>` (and JSX of
 * the same) is enough to bind "add a note" to `getByRole("button", { name: "Add" })`.
 */

import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { bashLc } from "./artifacts.js";
import { type UiStepSpec } from "./checkSpecs.js";
import { behavioralInfo } from "./log.js";

export type UiClickRole = "button" | "link" | "checkbox";

export type UiControlKind = "button" | "textbox" | "link" | "checkbox";

export type UiControl = {
  kind: UiControlKind;
  name?: string;
  placeholder?: string;
  inputType?: string;
  /** JSX/HTML handler the control calls, e.g. `toggle` from `onClick={() => toggle(note)}`. */
  handler?: string;
  className?: string;
  /** Extra tokens from surrounding source (e.g. a `✓` done marker in children). */
  signals?: string[];
  source: { path: string; line: number; snippet: string };
};

const SOURCE_EXT = /\.(jsx|tsx|js|ts|html|vue|svelte)$/i;
const SKIP_PATH =
  /(^|\/)(node_modules|dist|build|\.git|\.next|coverage|vendor|__tests__|__mocks__)(\/|$)/;
const SKIP_FILE = /\.(test|spec|min|d)\.[^.]+$/i;

const MAX_FILES = 80;
const MAX_FILE_BYTES = 80_000;
const MAX_TOTAL_BYTES = 800_000;
const MAX_CONTROLS = 200;
const MAX_SNIPPET = 160;
const FIND_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 8_000;

const TAG_NAMES = /^(button|input|textarea|a)\b/i;

export function extractUiControlsFromFiles(
  files: Array<{ path: string; content: string }>
): UiControl[] {
  const controls: UiControl[] = [];
  let bytes = 0;
  for (const file of files) {
    if (controls.length >= MAX_CONTROLS) break;
    if (!isSourcePath(file.path)) continue;
    const content =
      file.content.length > MAX_FILE_BYTES
        ? file.content.slice(0, MAX_FILE_BYTES)
        : file.content;
    bytes += content.length;
    if (bytes > MAX_TOTAL_BYTES) break;
    for (const control of scanSource(file.path, content)) {
      controls.push(control);
      if (controls.length >= MAX_CONTROLS) break;
    }
  }
  return controls;
}

export function formatUiControlCatalog(controls: UiControl[], maxChars = 4_000): string {
  if (!controls.length) return "(no UI controls found in source)";
  const lines = controls.map((c) => {
    const extras = [
      c.handler ? `handler=${c.handler}` : "",
      c.className ? `class="${c.className}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const label =
      c.kind === "textbox"
        ? `${c.kind}${c.placeholder ? ` placeholder="${c.placeholder}"` : c.name ? ` name="${c.name}"` : ""}`
        : `${c.kind}${c.name ? ` "${c.name}"` : " (unnamed)"}`;
    const annotated = extras ? `${label} ${extras}` : label;
    return `- ${annotated}  ${c.source.path}:${c.source.line}  ${c.source.snippet}`;
  });
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n… (truncated)`;
  return out;
}

export function findClickTarget(
  catalog: UiControl[],
  name: string,
  role?: UiClickRole
): UiControl | undefined {
  const wanted = name.trim();
  if (!wanted) return undefined;
  const kinds: UiControlKind[] = role ? [role] : ["button", "link", "checkbox"];
  const exact = catalog.find((c) => kinds.includes(c.kind) && c.name === wanted);
  if (exact) return exact;
  const lower = wanted.toLowerCase();
  return catalog.find(
    (c) => kinds.includes(c.kind) && c.name?.toLowerCase() === lower
  );
}

export function findTextbox(
  catalog: UiControl[],
  placeholder?: string
): UiControl | undefined {
  const boxes = catalog.filter((c) => c.kind === "textbox");
  if (!boxes.length) return undefined;
  if (!placeholder?.trim()) return boxes[0];
  const wanted = placeholder.trim();
  return (
    boxes.find((c) => c.placeholder === wanted || c.name === wanted) ||
    boxes.find(
      (c) =>
        c.placeholder?.toLowerCase() === wanted.toLowerCase() ||
        c.name?.toLowerCase() === wanted.toLowerCase()
    )
  );
}

export function clickRoleFromControl(
  control: UiControl
): Extract<UiStepSpec, { action: "click_role" }> | null {
  if (control.kind !== "button" && control.kind !== "link" && control.kind !== "checkbox") {
    return null;
  }
  const name = control.name?.trim();
  if (!name) return null;
  return { action: "click_role", role: control.kind, name, exact: true };
}

/**
 * Leftover `click_text` (employer-authored or generated before click_role)
 * binds to a catalog button/link/checkbox. Prose such as the notes-board lede
 * is not in the catalog, so it does not bind.
 */
export function bindClickTextToCatalog(
  text: string,
  catalog: UiControl[]
): Extract<UiStepSpec, { action: "click_role" }> | null {
  const hit = findClickTarget(catalog, text);
  return hit ? clickRoleFromControl(hit) : null;
}

/**
 * Rewrite click/fill steps onto catalog entries. Invented clicks (lede copy,
 * "No notes yet.") return null — same class of drop as invented HTTP paths.
 */
export function bindUiStepsToCatalog(
  steps: UiStepSpec[],
  catalog: UiControl[]
): UiStepSpec[] | null {
  if (!catalog.length) return null;
  const out: UiStepSpec[] = [];
  for (const step of steps) {
    if (step.action === "click_text") {
      const bound = bindClickTextToCatalog(step.text, catalog);
      if (!bound) return null;
      out.push(bound);
      continue;
    }
    if (step.action === "click_role") {
      const hit = findClickTarget(catalog, step.name, step.role);
      if (!hit) return null;
      const bound = clickRoleFromControl(hit);
      if (!bound) return null;
      out.push(bound);
      continue;
    }
    if (step.action === "click_in_row") {
      if (step.name) {
        const hit = findClickTarget(catalog, step.name, step.role);
        if (!hit) return null;
      }
      out.push(step);
      continue;
    }
    if (step.action === "fill_placeholder") {
      if (!findTextbox(catalog, step.placeholder)) return null;
      out.push(step);
      continue;
    }
    if (step.action === "fill_role") {
      if (!findTextbox(catalog)) return null;
      out.push(step);
      continue;
    }
    out.push(step);
  }
  return out;
}

export function mergeUiCatalog(base: UiControl[], extra: UiControl[]): UiControl[] {
  const seen = new Set(base.map(controlKey));
  const out = [...base];
  for (const c of extra) {
    const key = controlKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CONTROLS) break;
  }
  return out;
}

export async function loadSourceFilesFromSandbox(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<Array<{ path: string; content: string }>> {
  const paths = await listSourcePaths(ctx, repoPath);
  return readSourceFiles(ctx, repoPath, paths);
}

export async function extractUiControlsFromSandbox(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<UiControl[]> {
  const files = await loadSourceFilesFromSandbox(ctx, repoPath);
  const controls = extractUiControlsFromFiles(files);
  behavioralInfo("ui_catalog", {
    files: files.length,
    controls: controls.length,
  });
  return controls;
}

/**
 * One extra pass when a locator misses: search the repo for the control name
 * in source files we may have skipped on the first cap, then re-extract those.
 */
export async function deepenUiControlsFromSandbox(
  ctx: GradingSandboxContext,
  repoPath: string,
  query: string,
  existing: UiControl[]
): Promise<UiControl[]> {
  const needle = query.trim();
  if (!needle) return existing;
  const extraPaths = await grepSourcePaths(ctx, repoPath, needle);
  if (!extraPaths.length) return existing;
  const already = new Set(existing.map((c) => c.source.path));
  const fresh = extraPaths.filter((p) => !already.has(normalizePath(p)));
  if (!fresh.length) {
    // Re-read cited files anyway — the first pass may have truncated them.
    const cited = extraPaths.slice(0, 12);
    const files = await readSourceFiles(ctx, repoPath, cited);
    return mergeUiCatalog(existing, extractUiControlsFromFiles(files));
  }
  const files = await readSourceFiles(ctx, repoPath, fresh.slice(0, 20));
  const merged = mergeUiCatalog(existing, extractUiControlsFromFiles(files));
  behavioralInfo("ui_catalog_deepen", {
    query: needle.slice(0, 80),
    extraFiles: files.length,
    controls: merged.length,
  });
  return merged;
}

function controlKey(c: UiControl): string {
  return `${c.kind}|${c.name ?? ""}|${c.placeholder ?? ""}|${c.handler ?? ""}|${c.className ?? ""}|${c.source.path}:${c.source.line}`;
}

function isSourcePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (SKIP_PATH.test(normalized)) return false;
  const base = normalized.split("/").pop() || normalized;
  if (SKIP_FILE.test(base)) return false;
  return SOURCE_EXT.test(base);
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function scanSource(path: string, content: string): UiControl[] {
  const controls: UiControl[] = [];
  let i = 0;
  while (i < content.length) {
    const lt = content.indexOf("<", i);
    if (lt < 0) break;
    if (content.startsWith("</", lt) || content.startsWith("<!--", lt) || content.startsWith("<!", lt)) {
      i = lt + 2;
      continue;
    }
    const afterLt = content.slice(lt + 1);
    const tagMatch = afterLt.match(TAG_NAMES);
    if (!tagMatch) {
      i = lt + 1;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    const afterName = lt + 1 + tagMatch[1].length;
    const open = parseOpenTag(content, afterName);
    if (!open) {
      i = afterName;
      continue;
    }
    const line = lineNumber(content, lt);
    const snippet = snippetAt(content, lt);

    if (tag === "input") {
      const control = controlFromInput(open.attrs, path, line, snippet);
      if (control) controls.push(control);
      i = open.endOfOpen;
      continue;
    }

    let inner = "";
    if (!open.selfClosing) {
      const close = findCloseTag(content, open.endOfOpen, tag);
      if (close) {
        inner = content.slice(open.endOfOpen, close.start);
        i = close.end;
      } else {
        i = open.endOfOpen;
      }
    } else {
      i = open.endOfOpen;
    }

    const control = controlFromContainer(tag, open.attrs, inner, path, line, snippet);
    if (control) controls.push(control);
  }
  return controls;
}

function parseOpenTag(
  content: string,
  start: number
): { attrs: string; endOfOpen: number; selfClosing: boolean } | null {
  let i = start;
  let quote: string | null = null;
  let brace = 0;
  while (i < content.length) {
    const c = content[i];
    if (quote) {
      if (c === "\\" && quote !== "`") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "{") {
      brace += 1;
      i += 1;
      continue;
    }
    if (c === "}" && brace > 0) {
      brace -= 1;
      i += 1;
      continue;
    }
    if (brace > 0) {
      i += 1;
      continue;
    }
    if (c === ">") {
      const attrs = content.slice(start, i);
      return {
        attrs,
        endOfOpen: i + 1,
        selfClosing: /\/\s*$/.test(attrs),
      };
    }
    i += 1;
  }
  return null;
}

function findCloseTag(
  content: string,
  start: number,
  tag: string
): { start: number; end: number } | null {
  const close = `</${tag}`;
  let i = start;
  let quote: string | null = null;
  let brace = 0;
  let depth = 1;
  while (i < content.length) {
    const c = content[i];
    if (quote) {
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "{") {
      brace += 1;
      i += 1;
      continue;
    }
    if (c === "}" && brace > 0) {
      brace -= 1;
      i += 1;
      continue;
    }
    if (brace > 0) {
      i += 1;
      continue;
    }
    if (c === "<") {
      if (content.slice(i).toLowerCase().startsWith(close) && /[>\s/]/.test(content[i + close.length] || ">")) {
        depth -= 1;
        if (depth === 0) {
          const gt = content.indexOf(">", i + close.length);
          return { start: i, end: gt >= 0 ? gt + 1 : i + close.length };
        }
        i += close.length;
        continue;
      }
      const open = content.slice(i + 1).match(new RegExp(`^${tag}\\b`, "i"));
      if (open) depth += 1;
    }
    i += 1;
  }
  return null;
}

function controlFromInput(
  attrs: string,
  path: string,
  line: number,
  snippet: string
): UiControl | null {
  const type = (getAttr(attrs, "type") || "").toLowerCase();
  const placeholder = getAttr(attrs, "placeholder");
  const aria = getAttr(attrs, "aria-label");
  const name = aria || getAttr(attrs, "name");
  const source = { path: normalizePath(path), line, snippet };
  const extras = controlSignals(attrs);

  if (type === "submit" || type === "button" || type === "reset") {
    const label = aria || getAttr(attrs, "value") || name;
    return {
      kind: "button",
      ...(label ? { name: label } : {}),
      inputType: type,
      ...extras,
      source,
    };
  }
  if (type === "checkbox") {
    return {
      kind: "checkbox",
      ...(aria ? { name: aria } : {}),
      inputType: "checkbox",
      ...extras,
      source,
    };
  }
  if (
    !type ||
    type === "text" ||
    type === "search" ||
    type === "email" ||
    type === "url" ||
    type === "tel" ||
    type === "password"
  ) {
    return {
      kind: "textbox",
      ...(placeholder ? { placeholder } : {}),
      ...(aria || name ? { name: aria || name } : {}),
      ...(type ? { inputType: type } : {}),
      ...extras,
      source,
    };
  }
  return null;
}

function controlFromContainer(
  tag: string,
  attrs: string,
  inner: string,
  path: string,
  line: number,
  snippet: string
): UiControl | null {
  const source = { path: normalizePath(path), line, snippet };
  const aria = getAttr(attrs, "aria-label");
  const type = (getAttr(attrs, "type") || "").toLowerCase();
  const extras = controlSignals(attrs);

  if (tag === "textarea") {
    const placeholder = getAttr(attrs, "placeholder");
    return {
      kind: "textbox",
      ...(placeholder ? { placeholder } : {}),
      ...(aria ? { name: aria } : {}),
      inputType: "textarea",
      ...extras,
      source,
    };
  }

  if (tag === "a") {
    const name = aria || visibleText(inner);
    if (!name) return null;
    return { kind: "link", name, ...extras, source };
  }

  if (tag === "button") {
    const name = aria || visibleText(inner) || getAttr(attrs, "value");
    // Nameless buttons are still commands (the notes-board check-off control
    // renders `{note.done ? "✓" : ""}`). Keep them so purpose-linking can
    // bind by handler/className instead of accessible name.
    const innerSignals = /[✓✔]/.test(inner) ? { signals: ["✓"] } : {};
    return {
      kind: "button",
      ...(name ? { name } : {}),
      ...(type ? { inputType: type } : {}),
      ...extras,
      ...innerSignals,
      source,
    };
  }
  return null;
}

function controlSignals(attrs: string): { handler?: string; className?: string } {
  const handler = jsxHandler(attrs);
  const className = getAttr(attrs, "className") || getAttr(attrs, "class");
  return {
    ...(handler ? { handler } : {}),
    ...(className ? { className } : {}),
  };
}

/** `onClick={() => toggle(note)}` / `onClick={remove}` → `toggle` / `remove`. */
function jsxHandler(attrs: string): string | undefined {
  const m = attrs.match(
    /\bon(?:Click|Submit)\s*=\s*\{\s*(?:\(\s*[^)]*\s*\)\s*=>\s*)?([A-Za-z_$][\w$]*)/i
  );
  const name = m?.[1];
  if (!name || name === "e" || name === "event" || name === "ev") return undefined;
  return name;
}

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|[\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["']([^"']*)["']\\s*\\})`,
    "i"
  );
  const m = attrs.match(re);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw?.trim() ? decodeEntities(raw.trim()) : undefined;
}

function visibleText(inner: string): string {
  let s = stripJsxExpressions(inner);
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function stripJsxExpressions(inner: string): string {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === "{") {
      let depth = 1;
      i += 1;
      while (i < inner.length && depth > 0) {
        if (inner[i] === "{") depth += 1;
        else if (inner[i] === "}") depth -= 1;
        i += 1;
      }
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function snippetAt(content: string, index: number): string {
  const from = content.lastIndexOf("\n", index - 1) + 1;
  let to = content.indexOf("\n", index);
  if (to < 0) to = content.length;
  return content.slice(from, to).trim().slice(0, MAX_SNIPPET);
}

async function listSourcePaths(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<string[]> {
  const script = `find . \\( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/dist/*' -o -path '*/build/*' -o -path '*/.next/*' -o -path '*/coverage/*' -o -path '*/vendor/*' \\) -prune -o \\( -name '*.jsx' -o -name '*.tsx' -o -name '*.js' -o -name '*.ts' -o -name '*.html' -o -name '*.vue' -o -name '*.svelte' \\) -type f -print 2>/dev/null | head -${MAX_FILES}`;
  try {
    const r = await ctx.run(bashLc(script), {
      cwd: repoPath,
      timeoutMs: FIND_TIMEOUT_MS,
      requestTimeoutMs: FIND_TIMEOUT_MS,
    });
    return (r.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((p) => p && isSourcePath(p));
  } catch {
    return [];
  }
}

async function grepSourcePaths(
  ctx: GradingSandboxContext,
  repoPath: string,
  query: string
): Promise<string[]> {
  const escaped = query.replace(/'/g, `'\\''`);
  const script = `grep -RIl --include='*.jsx' --include='*.tsx' --include='*.js' --include='*.ts' --include='*.html' --include='*.vue' --include='*.svelte' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=build --exclude-dir=.next --exclude-dir=coverage -F '${escaped}' . 2>/dev/null | head -20`;
  try {
    const r = await ctx.run(bashLc(script), {
      cwd: repoPath,
      timeoutMs: FIND_TIMEOUT_MS,
      requestTimeoutMs: FIND_TIMEOUT_MS,
    });
    return (r.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((p) => p && isSourcePath(p));
  } catch {
    return [];
  }
}

async function readSourceFiles(
  ctx: GradingSandboxContext,
  repoPath: string,
  paths: string[]
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  let bytes = 0;
  for (const rel of paths) {
    if (files.length >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) break;
    const content = await readSandboxFile(ctx, repoPath, rel);
    if (content == null) continue;
    const sliced =
      content.length > MAX_FILE_BYTES ? content.slice(0, MAX_FILE_BYTES) : content;
    bytes += sliced.length;
    files.push({ path: normalizePath(rel), content: sliced });
  }
  return files;
}

async function readSandboxFile(
  ctx: GradingSandboxContext,
  repoPath: string,
  rel: string
): Promise<string | null> {
  const normalized = normalizePath(rel);
  const abs = `${repoPath.replace(/\/$/, "")}/${normalized}`;
  const sandbox = ctx.sandbox as {
    files?: { read?: (p: string) => Promise<unknown> };
  };
  try {
    if (typeof sandbox.files?.read === "function") {
      const content = await sandbox.files.read(abs);
      if (typeof content === "string") return content;
    }
  } catch {
    // Fall through to cat.
  }
  try {
    const quoted = normalized.replace(/'/g, `'\\''`);
    const r = await ctx.run(bashLc(`cat '${quoted}'`), {
      cwd: repoPath,
      timeoutMs: READ_TIMEOUT_MS,
      requestTimeoutMs: READ_TIMEOUT_MS,
    });
    if (r.exitCode !== 0) return null;
    return r.stdout || "";
  } catch {
    return null;
  }
}
