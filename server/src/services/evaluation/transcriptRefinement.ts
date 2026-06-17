/**
 * Orchestrates timestamp-aware transcript refinement:
 * raw JSONL → stateful interpretation → temporal insights → hybrid eval events.
 */

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "../capture/storage.js";
import { jsonlToScreenMoments } from "./momentGrouper.js";
import { interpretStateful } from "./interpreterStateful.js";
import { generateTemporalInsights } from "./timeAwareInsights.js";
import { buildEvaluationTranscript } from "./enrichedEvaluationAdapter.js";
import { proctoringJsonlToTranscriptEvents } from "./proctoringTranscriptAdapter.js";
import type { RefinedTranscript } from "../../types/evaluation.js";

/**
 * Run the full refinement pipeline on raw JSONL transcript content.
 */
export async function refineTranscriptFromJsonl(jsonl: string): Promise<RefinedTranscript> {
  const moments = jsonlToScreenMoments(jsonl);
  if (moments.length === 0) {
    const fallback = proctoringJsonlToTranscriptEvents(jsonl);
    return {
      version: "v2",
      enriched: {
        events: [],
        session_narrative: "",
        strategy: "stateful",
        processing_stats: { llm_calls: 0, total_tokens: 0, processing_time_ms: 0 },
      },
      temporal_insights: [],
      evaluation_events: fallback,
      refined_at: new Date().toISOString(),
    };
  }

  const enriched = await interpretStateful(moments);
  const temporal_insights = await generateTemporalInsights(enriched);
  const evaluation_events = buildEvaluationTranscript(jsonl, enriched, temporal_insights);

  return {
    version: "v2",
    enriched,
    temporal_insights,
    evaluation_events,
    refined_at: new Date().toISOString(),
  };
}

/**
 * Persist refined transcript to storage and update proctoring session metadata.
 */
export async function storeRefinedTranscript(
  sessionId: string,
  refined: RefinedTranscript
): Promise<string> {
  const storageKey = `${sessionId}/refined.json`;
  const storage = getFrameStorage();
  const content = JSON.stringify(refined);

  await storage.storeTranscript(storageKey, content);

  const tokenUsage = refined.enriched.processing_stats;
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.refinedStatus": "completed",
    "transcript.refinedStorageKey": storageKey,
    "transcript.refinedAt": new Date(),
    "transcript.refinedError": null,
    "transcript.refinedTokenUsage": {
      prompt: tokenUsage.total_tokens,
      completion: 0,
      total: tokenUsage.total_tokens,
    },
  });

  return storageKey;
}

/**
 * Mark refinement as failed on the proctoring session.
 */
export async function markRefinementFailed(
  sessionId: string,
  error: string
): Promise<void> {
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.refinedStatus": "failed",
    "transcript.refinedError": error.slice(0, 500),
  });
}

/**
 * Load a previously stored refined transcript, if any.
 */
export async function loadRefinedTranscript(
  sessionId: string
): Promise<RefinedTranscript | null> {
  const session = await ProctoringSessionModel.findById(sessionId).lean();
  const key = (session as { transcript?: { refinedStorageKey?: string } })?.transcript
    ?.refinedStorageKey;
  if (!key) return null;
  try {
    const storage = getFrameStorage();
    const content = await storage.getTranscript(key);
    return JSON.parse(content) as RefinedTranscript;
  } catch {
    return null;
  }
}
