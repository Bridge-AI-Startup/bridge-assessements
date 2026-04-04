/**
 * Inject sidecar events (tab switches, clipboard, etc.) into a JSONL transcript.
 * Events are inserted at chronologically correct positions.
 */

import { PreparedSidecarEvent } from "../../services/capture/framePrep.js";

interface TranscriptLine {
  ts: string;
  ts_end?: string;
  screen?: number;
  app?: string;
  description?: string;
  text_content?: string;
  event_type?: string;
}

/**
 * Inject sidecar events into a JSONL transcript string.
 * Returns a new JSONL string with event annotations inserted.
 */
export function injectSidecarEvents(
  jsonl: string,
  events: PreparedSidecarEvent[]
): string {
  if (events.length === 0) return jsonl;

  const lines: TranscriptLine[] = jsonl
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((l): l is TranscriptLine => l !== null);

  // Create event lines
  const eventLines: TranscriptLine[] = events.map((e) => ({
    ts: e.timestamp.toISOString(),
    description: formatEventDescription(e),
    event_type: e.type,
  }));

  // Merge and sort
  const all = [...lines, ...eventLines].sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    return ta - tb;
  });

  return all.map((line) => JSON.stringify(line)).join("\n");
}

function formatEventDescription(event: PreparedSidecarEvent): string {
  const descriptions: Record<string, string> = {
    tab_switch: "[EVENT] Candidate switched browser tabs",
    window_blur: "[EVENT] Candidate left the assessment window",
    window_focus: "[EVENT] Candidate returned to the assessment window",
    clipboard_copy: "[EVENT] Clipboard copy detected",
    clipboard_paste: "[EVENT] Clipboard paste detected",
    url_change: "[EVENT] URL changed",
    idle_start: "[EVENT] Candidate became idle",
    idle_end: "[EVENT] Candidate resumed activity",
    stream_lost: "[EVENT] Screen share stream was lost",
    stream_restored: "[EVENT] Screen share stream was restored",
  };

  return descriptions[event.type] || `[EVENT] ${event.type}`;
}
