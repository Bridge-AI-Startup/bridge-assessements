/**
 * Merge batch outputs into a single chronological JSONL transcript.
 * Accepts both old format (description) and new format (text_content + app).
 */

export interface TranscriptSegment {
  ts: string;
  ts_end?: string;
  screen: number;
  app?: string;
  description?: string;
  text_content?: string;
}

/**
 * Parse vision API output text into transcript segments.
 * Expects each line to be a valid JSON object in JSONL format.
 * Accepts lines with either "description" or "text_content" fields.
 */
function parseBatchOutput(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = text.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Strip markdown code fences if the model wraps output in ```json blocks
    const cleaned = line.trim().replace(/^```(?:json|jsonl)?/, "").replace(/^```$/, "").trim();
    if (!cleaned) continue;

    try {
      const parsed = JSON.parse(cleaned);
      // Accept if it has ts AND either text_content or description
      if (parsed.ts && (parsed.text_content || parsed.description)) {
        segments.push({
          ts: parsed.ts,
          ts_end: parsed.ts_end || undefined,
          screen: parsed.screen ?? 0,
          app: parsed.app || undefined,
          description: parsed.description || undefined,
          text_content: parsed.text_content || undefined,
        });
      } else {
        console.warn("[stitcher] Skipping line missing ts or content:", cleaned.substring(0, 100));
      }
    } catch {
      console.warn("[stitcher] Non-JSON line skipped:", cleaned.substring(0, 100));
    }
  }

  return segments;
}

/**
 * Stitch multiple batch outputs into a single JSONL string.
 * Sorts by timestamp, deduplicates overlapping segments.
 */
export function stitchBatchOutputs(batchOutputs: string[]): string {
  const allSegments: TranscriptSegment[] = [];

  for (let i = 0; i < batchOutputs.length; i++) {
    const parsed = parseBatchOutput(batchOutputs[i]);
    console.log(`[stitcher] Batch ${i}: parsed ${parsed.length} segments from ${batchOutputs[i].split("\n").length} lines`);
    allSegments.push(...parsed);
  }

  console.log(`[stitcher] Total segments after stitching: ${allSegments.length}`);

  // Sort by timestamp
  allSegments.sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    if (ta !== tb) return ta - tb;
    return a.screen - b.screen;
  });

  // Convert to JSONL
  return allSegments.map((seg) => JSON.stringify(seg)).join("\n");
}
