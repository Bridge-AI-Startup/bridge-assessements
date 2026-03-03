/**
 * Transcript generation orchestrator.
 * Prepares frames → batches → vision API → stitch → inject events → store.
 */

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { prepareSessionForTranscript } from "../../services/capture/framePrep.js";
import { getFrameStorage } from "../../services/capture/storage.js";
import { ProctoringError } from "../../errors/proctoring.js";
import { createBatches } from "./batcher.js";
import { analyzeFrameBatch } from "./visionClient.js";
import { stitchBatchOutputs } from "./stitcher.js";
import { injectSidecarEvents } from "./manifestInjector.js";
import { PROMPT_TRANSCRIPT_SYSTEM } from "../../prompts/index.js";

export interface TranscriptResult {
  storageKey: string;
  frameCount: number;
  tokenUsage: { prompt: number; completion: number; total: number };
}

/**
 * Generate a raw visual transcript for a proctoring session.
 * This is the single entry point called by the controller.
 */
export async function generateTranscript(
  sessionId: string
): Promise<TranscriptResult> {
  // Check if generation is enabled
  if (process.env.TRANSCRIPT_GENERATION_ENABLED === "false") {
    throw ProctoringError.TRANSCRIPT_GENERATION_DISABLED;
  }

  // Check session status
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) throw ProctoringError.SESSION_NOT_FOUND;

  if (session.transcript.status === "generating") {
    throw ProctoringError.TRANSCRIPT_ALREADY_GENERATING;
  }

  // Mark as generating
  await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
    "transcript.status": "generating",
    "transcript.error": null,
  });

  try {
    console.log(`[transcript] Preparing session ${sessionId}...`);
    const prepared = await prepareSessionForTranscript(sessionId);
    console.log(`[transcript] Prepared: ${prepared.frames.length} frames, ${prepared.sidecarEvents.length} sidecar events`);

    if (prepared.frames.length === 0) {
      throw new Error("No frames available for transcript generation");
    }

    for (const f of prepared.frames) {
      console.log(`[transcript]   Frame: ${f.storageKey} | ${f.width}x${f.height} | screen ${f.screenIndex} | ${f.capturedAt.toISOString()} | ${f.buffer.length} bytes`);
    }

    const batches = createBatches(prepared.frames);
    console.log(`[transcript] Created ${batches.length} batch(es)`);

    const batchOutputs: string[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const batch of batches) {
      console.log(`[transcript] Processing batch ${batch.batchIndex} (${batch.frames.length} frames)...`);
      const visionFrames = batch.frames.map((f) => ({
        buffer: f.buffer,
        capturedAt: f.capturedAt,
        screenIndex: f.screenIndex,
      }));

      const result = await analyzeFrameBatch(
        visionFrames,
        PROMPT_TRANSCRIPT_SYSTEM
      );

      console.log(`[transcript] Batch ${batch.batchIndex}: ${result.promptTokens} prompt + ${result.completionTokens} completion tokens`);
      console.log(`[transcript] Batch ${batch.batchIndex} raw output (first 500 chars):\n${result.text.substring(0, 500)}`);

      batchOutputs.push(result.text);
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;
    }

    console.log(`[transcript] Stitching ${batchOutputs.length} batch outputs...`);
    let jsonl = stitchBatchOutputs(batchOutputs);
    const lineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    console.log(`[transcript] Stitched: ${lineCount} JSONL lines`);

    jsonl = injectSidecarEvents(jsonl, prepared.sidecarEvents);
    const finalLineCount = jsonl.split("\n").filter((l: string) => l.trim()).length;
    console.log(`[transcript] After sidecar injection: ${finalLineCount} lines`);

    const storage = getFrameStorage();
    const storageKey = `${sessionId}/transcript.jsonl`;
    await storage.storeTranscript(storageKey, jsonl);
    console.log(`[transcript] Stored at ${storageKey}`);

    const tokenUsage = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.status": "completed",
      "transcript.storageKey": storageKey,
      "transcript.generatedAt": new Date(),
      "transcript.frameCount": prepared.frames.length,
      "transcript.tokenUsage": tokenUsage,
    });

    console.log(`[transcript] Done! ${prepared.frames.length} frames → ${finalLineCount} segments | ${totalPromptTokens + totalCompletionTokens} total tokens`);

    return {
      storageKey,
      frameCount: prepared.frames.length,
      tokenUsage,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[transcript] FAILED for session ${sessionId}:`, errorMessage);
    if (error instanceof Error && error.stack) {
      console.error(`[transcript] Stack:`, error.stack);
    }
    await ProctoringSessionModel.findByIdAndUpdate(sessionId, {
      "transcript.status": "failed",
      "transcript.error": errorMessage,
    });
    throw error;
  }
}
