/**
 * Derive live file-state updates from capture-kit events.
 *
 * Claude Code's Write tool carries full contents on the tool_use. Edit and
 * MultiEdit only carry a diff there — the full file lands on the matching
 * tool_result (`originalFile` + old/new strings) or on a Read result.
 * Treating an Edit tool_use as an empty file is how the companion once told
 * a candidate their server.js was empty while they were mid-edit.
 */

export type CaptureFileUpdate = { path: string; content: string };

type LooseEvent = {
  type?: unknown;
  toolName?: unknown;
  text?: unknown;
  payload?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function filePathOf(input: Record<string, unknown> | null): string | null {
  if (!input) return null;
  const path = input.file_path ?? input.filePath ?? input.path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

function applySingleEdit(
  source: string,
  oldString: unknown,
  newString: unknown
): string | null {
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  if (!source.includes(oldString)) return null;
  return source.replace(oldString, newString);
}

function contentFromEditResult(
  result: Record<string, unknown>
): string | null {
  const original =
    typeof result.originalFile === "string" ? result.originalFile : null;
  if (original == null) return null;

  const edits = Array.isArray(result.edits) ? result.edits : null;
  if (edits && edits.length > 0) {
    let next = original;
    for (const edit of edits) {
      const rec = asRecord(edit);
      if (!rec) return null;
      const applied = applySingleEdit(
        next,
        rec.old_string ?? rec.oldString,
        rec.new_string ?? rec.newString
      );
      if (applied == null) return null;
      next = applied;
    }
    return next;
  }

  return applySingleEdit(
    original,
    result.old_string ?? result.oldString,
    result.new_string ?? result.newString
  );
}

function updatesFromOneEvent(raw: LooseEvent): CaptureFileUpdate[] {
  const type = String(raw?.type || "");
  const toolName = raw?.toolName ? String(raw.toolName) : "";
  const payload = asRecord(raw?.payload);

  if (type === "tool_use" && /^Write$/i.test(toolName)) {
    const input = asRecord(payload?.tool_input) ?? asRecord(payload?.input);
    const path = filePathOf(input);
    const content = input && typeof input.content === "string" ? input.content : null;
    if (path && content != null && content.length > 0) {
      return [{ path, content }];
    }
    return [];
  }

  if (type !== "tool_result") return [];

  const result = parseJsonObject(raw?.text) ?? parseJsonObject(payload?.tool_response);
  if (!result) return [];

  if (/^Read$/i.test(toolName)) {
    if (result.type === "image") return [];
    const file = asRecord(result.file);
    const path = filePathOf(file) ?? filePathOf(result);
    const content =
      (file && typeof file.content === "string" && file.content) ||
      (typeof result.content === "string" ? result.content : null);
    if (path && content != null && content.length > 0) {
      return [{ path, content }];
    }
    return [];
  }

  if (/^(Edit|MultiEdit|Write)$/i.test(toolName)) {
    const path = filePathOf(result);
    if (!path) return [];
    if (/^Write$/i.test(toolName) && typeof result.content === "string" && result.content) {
      return [{ path, content: result.content }];
    }
    const content = contentFromEditResult(result);
    if (content != null && content.length > 0) {
      return [{ path, content }];
    }
  }

  return [];
}

/** Last write per path wins so a Read-then-Edit batch stores the edited file. */
export function fileUpdatesFromCaptureEvents(
  events: LooseEvent[]
): CaptureFileUpdate[] {
  const byPath = new Map<string, string>();
  for (const raw of events) {
    for (const update of updatesFromOneEvent(raw)) {
      byPath.set(update.path, update.content);
    }
  }
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}
