import type { TranscriptEvent } from "../../types/evaluation.js";

/**
 * Bound the size of a transcript before it is serialized into an LLM prompt.
 *
 * Long sessions (e.g. a real 5+ minute screen recording) can produce hundreds
 * of events whose descriptions, when JSON-serialized in full, exceed the
 * model's context window (we observed ~131k tokens > 128k limit). This compacts
 * the transcript to fit a character budget while preserving chronology and the
 * highest-signal events.
 *
 * Strategy:
 *  1. Truncate each long free-text field (description / prompt_text).
 *  2. If still over budget, downsample events — always keeping high-signal
 *     events (AI prompts/responses, testing, searching) when possible, and
 *     evenly sampling the remaining lower-signal events (coding/reading/idle).
 */

const MAX_FIELD_CHARS = 240;
const HIGH_SIGNAL: ReadonlySet<string> = new Set([
  "ai_prompt",
  "ai_response",
  "testing",
  "searching",
]);

function truncate(s: string | null): string | null {
  if (s == null) return s;
  return s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) + "…" : s;
}

/** Pick `n` evenly-spaced items (always including first and last). */
function evenSample<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return [...arr];
  if (n <= 1) return arr.length ? [arr[0]] : [];
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  // de-dup adjacent picks (possible when step < 1 rounding collides)
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * Return a transcript whose JSON serialization fits within ~`maxChars`.
 * Defaults to ~160k chars (~40k tokens), leaving ample room for the system
 * prompt, grounding text and the model's completion within a 128k window.
 */
export function compactTranscriptForPrompt(
  events: TranscriptEvent[],
  maxChars = 160_000
): TranscriptEvent[] {
  if (!Array.isArray(events) || events.length === 0) return events ?? [];

  let compact: TranscriptEvent[] = events.map((e) => ({
    ...e,
    description: truncate(e.description) ?? "",
    prompt_text: truncate(e.prompt_text),
    search_query: truncate(e.search_query),
  }));

  if (JSON.stringify(compact).length <= maxChars) return compact;

  const high = compact.filter((e) => HIGH_SIGNAL.has(e.action_type));
  const low = compact.filter((e) => !HIGH_SIGNAL.has(e.action_type));

  const avg = JSON.stringify(compact).length / compact.length;
  const budgetCount = Math.max(20, Math.floor(maxChars / Math.max(1, avg)));

  let kept: TranscriptEvent[];
  if (high.length >= budgetCount) {
    kept = evenSample(high, budgetCount);
  } else {
    kept = [...high, ...evenSample(low, Math.max(0, budgetCount - high.length))];
  }
  kept.sort((a, b) => a.ts - b.ts);

  // Final guard: shrink until it fits. Drop low-signal events first so the
  // high-signal ones (AI/testing/searching) survive as long as possible.
  while (kept.length > 20 && JSON.stringify(kept).length > maxChars) {
    const keptHigh = kept.filter((e) => HIGH_SIGNAL.has(e.action_type));
    const keptLow = kept.filter((e) => !HIGH_SIGNAL.has(e.action_type));
    if (keptLow.length > 0) {
      kept = [...keptHigh, ...evenSample(keptLow, Math.floor(keptLow.length * 0.8))];
    } else {
      kept = evenSample(kept, Math.floor(kept.length * 0.8));
    }
    kept.sort((a, b) => a.ts - b.ts);
  }
  return kept;
}
