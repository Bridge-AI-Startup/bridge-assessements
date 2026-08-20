/**
 * Search/replace patches for serverless follow-up builds.
 *
 * A first BUILD still returns a full HTML document. Later turns should send
 * one or more exact-substring patches so we are not regenerating the whole
 * file (and waiting minutes) for "make the tank jump".
 */

export type HtmlPatch = { search: string; replace: string };

export class PatchApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchApplyError";
  }
}

const MAX_PATCHES = 30;
const PATCH_RE =
  /\*{3}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n\*{3}\s*REPLACE\s*\r?\n([\s\S]*?)\r?\n\*{3}\s*END/g;

export function parseHtmlPatches(raw: string): HtmlPatch[] {
  const patches: HtmlPatch[] = [];
  const text = String(raw || "");
  for (const match of text.matchAll(PATCH_RE)) {
    const search = match[1] ?? "";
    const replace = match[2] ?? "";
    if (!search) continue;
    patches.push({ search, replace });
    if (patches.length >= MAX_PATCHES) break;
  }
  return patches;
}

export function stripHtmlPatchBlocks(raw: string): string {
  return String(raw || "")
    .replace(PATCH_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

export function applyHtmlPatches(html: string, patches: HtmlPatch[]): string {
  if (!patches.length) {
    throw new PatchApplyError("No patches in that reply.");
  }
  let next = html;
  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i];
    const hits = countOccurrences(next, patch.search);
    if (hits === 0) {
      throw new PatchApplyError(
        `Patch ${i + 1} did not match the current file.`,
      );
    }
    if (hits > 1) {
      throw new PatchApplyError(
        `Patch ${i + 1} matched ${hits} places — it has to be unique.`,
      );
    }
    const at = next.indexOf(patch.search);
    next =
      next.slice(0, at) + patch.replace + next.slice(at + patch.search.length);
  }
  return next;
}
