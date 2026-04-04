/**
 * Converts raw LLM events (moment_range indices) into enriched events
 * with deterministic timestamps. The LLM never outputs timestamps —
 * it only references moments by index, and we compute ts/ts_end from
 * the pre-computed LLMMoment data.
 */

import type { LLMMoment } from "./momentGrouper.js";
import type { EnrichedTranscriptEvent } from "../../types/evaluation.js";

interface RawLLMEvent {
  moment_range: [number, number];
  behavioral_summary: string;
  intent: string;
  ai_tool: string | null;
}

/**
 * Resolve LLM events (with moment indices) into EnrichedTranscriptEvents
 * (with deterministic timestamps and populated region data).
 *
 * @param rawEvents - Events from the LLM, referencing moments by index
 * @param moments - The LLMMoment array that was sent to the LLM (local to this chunk/batch)
 * @param globalMomentOffset - Offset to add to local indices when computing global timestamps
 *                             (used by chunked strategy where each chunk has local indices)
 * @param allMoments - The full session LLMMoment array (for timestamp lookup when using global offset)
 */
export function resolveEvents(
  rawEvents: RawLLMEvent[],
  moments: LLMMoment[],
): EnrichedTranscriptEvent[] {
  if (rawEvents.length === 0 || moments.length === 0) return [];

  const maxIdx = moments.length - 1;

  return rawEvents.map((e) => {
    let [startIdx, endIdx] = e.moment_range;

    startIdx = clamp(Math.round(startIdx), 0, maxIdx);
    endIdx = clamp(Math.round(endIdx), 0, maxIdx);
    if (endIdx < startIdx) endIdx = startIdx;

    const coveredMoments = moments.slice(startIdx, endIdx + 1);

    return {
      ts: moments[startIdx].ts_seconds,
      ts_end: moments[endIdx].ts_end_seconds,
      behavioral_summary: e.behavioral_summary,
      intent: e.intent,
      regions_present: extractRegionsPresent(coveredMoments),
      ai_tool: e.ai_tool,
      raw_regions: extractRawRegions(coveredMoments),
    };
  });
}

function extractRegionsPresent(moments: LLMMoment[]): string[] {
  const regions = new Set<string>();
  for (const m of moments) {
    for (const r of m.regions) regions.add(r.region);
  }
  return Array.from(regions);
}

function extractRawRegions(moments: LLMMoment[]): { region: string; text_content: string }[] {
  const seen = new Set<string>();
  const result: { region: string; text_content: string }[] = [];
  for (const m of moments) {
    for (const r of m.regions) {
      if (!seen.has(r.region)) {
        seen.add(r.region);
        result.push({ region: r.region, text_content: r.text_content });
      }
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
