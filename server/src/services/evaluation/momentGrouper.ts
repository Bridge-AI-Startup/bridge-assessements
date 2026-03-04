/**
 * Groups raw JSONL transcript lines into ScreenMoment[] by timestamp.
 * Multiple JSONL entries at the same timestamp (one per visible region)
 * are bundled into a single ScreenMoment representing the full screen state.
 */

import type { ScreenMoment, RegionSnapshot } from "../../types/evaluation.js";

/**
 * A moment with pre-computed relative timestamps for LLM consumption.
 * The LLM receives these directly so it never has to parse ISO strings
 * or do epoch arithmetic.
 */
export type LLMMoment = {
  ts_seconds: number;
  ts_end_seconds: number;
  regions: RegionSnapshot[];
};

/**
 * Convert ScreenMoments (ISO timestamps) into LLMMoments (seconds since
 * session start). The first moment defines t=0.
 */
export function prepareMomentsForLLM(moments: ScreenMoment[]): LLMMoment[] {
  if (moments.length === 0) return [];
  const baseMs = new Date(moments[0].ts).getTime();
  return moments.map((m) => ({
    ts_seconds: Math.round((new Date(m.ts).getTime() - baseMs) / 1000),
    ts_end_seconds: Math.round((new Date(m.ts_end).getTime() - baseMs) / 1000),
    regions: m.regions,
  }));
}

interface RawJsonlSegment {
  ts: string;
  ts_end?: string;
  screen?: number;
  region?: string;
  app?: string;
  text_content?: string;
  description?: string;
  event_type?: string;
}

/**
 * Parse raw JSONL string into ScreenMoment[], grouping entries by timestamp.
 * Sidecar events (window_blur, window_focus, etc.) are skipped since they
 * don't have region/text_content and aren't useful for activity interpretation.
 */
export function jsonlToScreenMoments(jsonl: string): ScreenMoment[] {
  const segments = parseSegments(jsonl);
  if (segments.length === 0) return [];

  const momentMap = new Map<string, { ts_end: string; regions: RegionSnapshot[] }>();

  for (const seg of segments) {
    const key = seg.ts;
    const existing = momentMap.get(key);
    const region: RegionSnapshot = {
      region: seg.region || "unknown",
      app: seg.app || "unknown",
      text_content: seg.text_content || seg.description || "",
    };

    if (existing) {
      existing.regions.push(region);
      if (seg.ts_end && seg.ts_end > existing.ts_end) {
        existing.ts_end = seg.ts_end;
      }
    } else {
      momentMap.set(key, {
        ts_end: seg.ts_end || seg.ts,
        regions: [region],
      });
    }
  }

  const moments: ScreenMoment[] = [];
  momentMap.forEach((data, ts) => {
    moments.push({ ts, ts_end: data.ts_end, regions: data.regions });
  });

  moments.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return moments;
}

function parseSegments(jsonl: string): RawJsonlSegment[] {
  const segments: RawJsonlSegment[] = [];
  const lines = jsonl.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const cleaned = line
      .trim()
      .replace(/^```(?:json|jsonl)?/, "")
      .replace(/^```$/, "")
      .trim();
    if (!cleaned) continue;

    try {
      const parsed = JSON.parse(cleaned) as RawJsonlSegment;
      if (parsed.event_type) continue;
      if (parsed.ts && (parsed.text_content != null || parsed.description != null)) {
        segments.push(parsed);
      }
    } catch {
      // skip malformed
    }
  }

  return segments.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}

/**
 * Build a compact index of moments for Strategy A boundary detection.
 * Each moment is summarized as: seconds offset, regions present, first ~50 chars of each.
 */
export function buildCompactIndex(moments: LLMMoment[]): string {
  return moments
    .map((m, i) => {
      const regionSummaries = m.regions
        .map((r) => {
          const preview = r.text_content.slice(0, 50).replace(/\n/g, " ");
          return `${r.region}: "${preview}${r.text_content.length > 50 ? "..." : ""}"`;
        })
        .join(", ");
      return `M${i} [${m.ts_seconds}s]: ${regionSummaries}`;
    })
    .join("\n");
}
