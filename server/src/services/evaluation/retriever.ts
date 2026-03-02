import type { TranscriptEvent, GroundedCriterion } from "../../types/evaluation.js"

const CONTEXT_WINDOW_SECONDS = 30

export function retrieveRelevantEvents(
  transcript: TranscriptEvent[],
  groundedCriterion: GroundedCriterion
): TranscriptEvent[] {
  // Step 1: Find events whose action_type is in the relevant_action_types list
  const matchedEvents = transcript.filter((event) =>
    groundedCriterion.relevant_action_types.includes(event.action_type)
  )

  // Step 4: Fallback — if no matched events, return the full transcript
  if (matchedEvents.length === 0) {
    return [...transcript].sort((a, b) => a.ts - b.ts)
  }

  // Step 2: For each matched event, collect events within a 30-second window
  // before and after it, then deduplicate
  const includedIndices = new Set<number>()

  for (const matched of matchedEvents) {
    const windowStart = matched.ts - CONTEXT_WINDOW_SECONDS
    const windowEnd = matched.ts_end + CONTEXT_WINDOW_SECONDS

    for (let i = 0; i < transcript.length; i++) {
      const event = transcript[i]
      // Include if the event's time range overlaps with the context window
      if (event.ts_end >= windowStart && event.ts <= windowEnd) {
        includedIndices.add(i)
      }
    }
  }

  // Step 3: Collect deduplicated events and sort by ts ascending
  const result = Array.from(includedIndices).map((i) => transcript[i])
  result.sort((a, b) => a.ts - b.ts)

  return result
}
