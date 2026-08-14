/**
 * Unified product-command inventory: UI controls (including nameless ones)
 * plus HTTP routes from `fetch` / Express. Behavioral checks name purposes;
 * this list is what those purposes are allowed to bind to.
 *
 * Playwright is still the hands. Nothing here searches the live page.
 */

import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import {
  extractUiControlsFromFiles,
  loadSourceFilesFromSandbox,
  type UiControl,
} from "./extractUiControls.js";
import { behavioralInfo } from "./log.js";

export type CapabilityKind = "ui.click" | "ui.fill" | "http";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Capability = {
  id: string;
  kind: CapabilityKind;
  role?: "button" | "link" | "checkbox" | "textbox";
  name?: string;
  placeholder?: string;
  className?: string;
  handler?: string;
  method?: HttpMethod;
  path?: string;
  source: { path: string; line: number; snippet: string };
  signals: string[];
};

const MAX_CAPABILITIES = 300;

const HTTP_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export function extractCapabilitiesFromFiles(
  files: Array<{ path: string; content: string }>
): Capability[] {
  const controls = extractUiControlsFromFiles(files);
  return mergeCapabilities(
    uiControlsToCapabilities(controls),
    extractHttpCapabilities(files)
  );
}

export function uiControlsToCapabilities(controls: UiControl[]): Capability[] {
  const out: Capability[] = [];
  for (const c of controls) {
    const kind: CapabilityKind =
      c.kind === "textbox" ? "ui.fill" : "ui.click";
    const role =
      c.kind === "textbox"
        ? ("textbox" as const)
        : c.kind;
    const signals = [
      ...(c.signals ?? []),
      ...(c.handler ? [c.handler] : []),
      ...(c.className ? [c.className] : []),
      ...(c.name ? [c.name] : []),
    ];
    const extra = c.handler || c.name || c.placeholder || c.className || "anon";
    out.push({
      id: capabilityId(kind, c.source, extra),
      kind,
      role,
      ...(c.name ? { name: c.name } : {}),
      ...(c.placeholder ? { placeholder: c.placeholder } : {}),
      ...(c.className ? { className: c.className } : {}),
      ...(c.handler ? { handler: c.handler } : {}),
      source: c.source,
      signals,
    });
  }
  return out;
}

export async function extractCapabilitiesFromSandbox(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<{ capabilities: Capability[]; controls: UiControl[] }> {
  const files = await loadSourceFilesFromSandbox(ctx, repoPath);
  const controls = extractUiControlsFromFiles(files);
  const capabilities = mergeCapabilities(
    uiControlsToCapabilities(controls),
    extractHttpCapabilities(files)
  );
  behavioralInfo("capability_inventory", {
    files: files.length,
    controls: controls.length,
    capabilities: capabilities.length,
    http: capabilities.filter((c) => c.kind === "http").length,
  });
  return { capabilities, controls };
}

export function formatCapabilityInventory(
  capabilities: Capability[],
  maxChars = 6_000
): string {
  if (!capabilities.length) return "(no capabilities found in source)";
  const lines = capabilities.map((c) => {
    if (c.kind === "http") {
      return `- id=${c.id}  ${c.method} ${c.path}  ${c.source.path}:${c.source.line}  signals=${c.signals.join(",") || "—"}`;
    }
    const label =
      c.kind === "ui.fill"
        ? `fill ${c.placeholder ? `placeholder="${c.placeholder}"` : c.name ? `"${c.name}"` : "textbox"}`
        : `click ${c.role ?? "button"}${c.name ? ` "${c.name}"` : " (unnamed)"}${c.handler ? ` handler=${c.handler}` : ""}${c.className ? ` class=${c.className}` : ""}`;
    return `- id=${c.id}  ${label}  ${c.source.path}:${c.source.line}`;
  });
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n… (truncated)`;
  return out;
}

export function sourceHint(cap: Capability): string {
  return `${cap.source.path}:${cap.source.line}`;
}

function extractHttpCapabilities(
  files: Array<{ path: string; content: string }>
): Capability[] {
  const out: Capability[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const cap of scanHttp(file.path, file.content)) {
      const key = `${cap.method}:${cap.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cap);
      if (out.length >= MAX_CAPABILITIES) return out;
    }
  }
  return out;
}

function scanHttp(path: string, content: string): Capability[] {
  const caps: Capability[] = [];
  const fetchRe =
    /\bfetch\s*\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*\{([\s\S]{0,500}?)\})?/g;
  let m: RegExpExecArray | null;
  while ((m = fetchRe.exec(content))) {
    const rawPath = m[2];
    const opts = m[3] ?? "";
    const methodMatch = opts.match(/method\s*:\s*['"](\w+)['"]/i);
    const method = normalizeMethod(methodMatch?.[1] || "GET");
    if (!method) continue;
    const normalized = normalizeHttpPath(rawPath);
    if (!normalized) continue;
    const snippet = snippetAt(content, m.index);
    const line = lineNumber(content, m.index);
    const signals = httpSignals(opts + " " + snippet, method, normalized);
    caps.push({
      id: capabilityId("http", { path, line }, `${method}:${normalized}`),
      kind: "http",
      method,
      path: normalized,
      source: { path: normalizePath(path), line, snippet },
      signals,
    });
  }

  const expressRe =
    /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  while ((m = expressRe.exec(content))) {
    const method = normalizeMethod(m[1]);
    if (!method) continue;
    const normalized = normalizeHttpPath(m[3]);
    if (!normalized) continue;
    const snippet = snippetAt(content, m.index);
    const line = lineNumber(content, m.index);
    const nearby = content.slice(m.index, m.index + 280);
    const signals = httpSignals(nearby, method, normalized);
    caps.push({
      id: capabilityId("http", { path, line }, `${method}:${normalized}`),
      kind: "http",
      method,
      path: normalized,
      source: { path: normalizePath(path), line, snippet },
      signals,
    });
  }
  return caps;
}

function httpSignals(hay: string, method: HttpMethod, path: string): string[] {
  const signals = [method, path];
  if (/\bdone\b/.test(hay)) signals.push("done");
  if (/\bok\b/.test(hay)) signals.push("ok");
  if (/health/i.test(path) || /health/i.test(hay)) signals.push("health");
  return signals;
}

export function normalizeHttpPath(raw: string): string | null {
  let p = raw.trim();
  if (!p) return null;
  p = p.split("?")[0];
  p = p.replace(/\$\{[^}]+\}/g, ":id");
  p = p.replace(/:([A-Za-z_][\w]*)/g, (full, name: string) =>
    name === "id" || /id$/i.test(name) ? ":id" : full
  );
  if (p === "*" || p === "/*") return null;
  if (!p.startsWith("/") || p.includes("..") || /^\w+:\/\//.test(p)) return null;
  return p;
}

function normalizeMethod(raw: string): HttpMethod | null {
  const m = raw.trim().toUpperCase() as HttpMethod;
  return HTTP_METHODS.has(m) ? m : null;
}

function capabilityId(
  kind: CapabilityKind,
  source: { path: string; line: number },
  extra: string
): string {
  const slug = `${kind}:${normalizePath(source.path)}:${source.line}:${extra}`
    .replace(/[^a-zA-Z0-9._:/-]/g, "_")
    .slice(0, 120);
  return slug;
}

function mergeCapabilities(a: Capability[], b: Capability[]): Capability[] {
  const seen = new Set(a.map((c) => c.id));
  const out = [...a];
  for (const c of b) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= MAX_CAPABILITIES) break;
  }
  return out;
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
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
  return content.slice(from, to).trim().slice(0, 160);
}
