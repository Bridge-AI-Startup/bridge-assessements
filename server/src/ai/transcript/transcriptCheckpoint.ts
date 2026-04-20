/**
 * Disk-backed checkpoints for full-session transcript generation (VLM path).
 * Enables resume after crash/rate-limit without redoing completed vision work.
 */

import crypto from "crypto";
import type { PreparedFrame } from "../../services/capture/framePrep.js";
import { getFrameStorage } from "../../services/capture/storage.js";

export const TRANSCRIPT_CHECKPOINT_VERSION = 1;

export const TRANSCRIPT_GEN_CHECKPOINT_KEY = "transcript-gen-checkpoint.json";

export type TranscriptCheckpointMode = "prompt_only" | "region";

export type PromptOnlyBatchEntry = {
  text: string;
  promptTokens: number;
  completionTokens: number;
};

export type RegionOpEntry = {
  kind: string;
  inputHash: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
};

export type TranscriptGenCheckpoint = {
  version: number;
  fingerprint: string;
  mode: TranscriptCheckpointMode;
  promptOnly?: { batches: Record<string, PromptOnlyBatchEntry> };
  region?: { ops: RegionOpEntry[] };
};

export class TranscriptCheckpointMismatchError extends Error {
  readonly name = "TranscriptCheckpointMismatchError";
  constructor(message: string) {
    super(message);
  }
}

export function getTranscriptCheckpointStorageKey(sessionId: string): string {
  return `${sessionId}/${TRANSCRIPT_GEN_CHECKPOINT_KEY}`;
}

/** Fast stable hash for buffers (aligned with generator.simpleBufferHash). */
export function hashBufferSample(buffer: Buffer): string {
  let hash = 0;
  const step = Math.max(1, Math.floor(buffer.length / 200));
  for (let i = 0; i < buffer.length; i += step) {
    hash = ((hash << 5) - hash + buffer[i]!) | 0;
  }
  return String(hash);
}

export function computeRegionOpInputHash(parts: (string | number)[]): string {
  const h = crypto.createHash("sha256");
  for (const p of parts) {
    h.update(String(p));
    h.update("\x1e");
  }
  return h.digest("hex").slice(0, 32);
}

export function computeTranscriptFingerprint(
  frames: PreparedFrame[],
  options: {
    regionDetection: boolean;
    batchSize: number;
    regionBatchSize: number;
    layoutRedetectInterval: number;
  }
): string {
  const keys = frames.map((f) => f.storageKey).join("\0");
  const h = crypto.createHash("sha256");
  h.update(keys);
  h.update(
    `|r=${options.regionDetection}|bs=${options.batchSize}|rbs=${options.regionBatchSize}|lri=${options.layoutRedetectInterval}|v=${TRANSCRIPT_CHECKPOINT_VERSION}`
  );
  return h.digest("hex");
}

export async function loadTranscriptCheckpoint(
  sessionId: string
): Promise<TranscriptGenCheckpoint | null> {
  const storage = getFrameStorage();
  const key = getTranscriptCheckpointStorageKey(sessionId);
  try {
    if (!(await storage.exists(key))) return null;
    const raw = await storage.getTranscript(key);
    const parsed = JSON.parse(raw) as TranscriptGenCheckpoint;
    if (parsed.version !== TRANSCRIPT_CHECKPOINT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveTranscriptCheckpoint(
  sessionId: string,
  data: TranscriptGenCheckpoint
): Promise<void> {
  const storage = getFrameStorage();
  const key = getTranscriptCheckpointStorageKey(sessionId);
  await storage.storeTranscript(key, JSON.stringify(data));
}

export async function clearTranscriptCheckpoint(sessionId: string): Promise<void> {
  const storage = getFrameStorage();
  const key = getTranscriptCheckpointStorageKey(sessionId);
  try {
    if (await storage.exists(key)) {
      await storage.delete(key);
    }
  } catch {
    /* ignore */
  }
}

export type VisionTokenResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
};

export type RegionCheckpointHandlers = {
  tryReplayOrRun: (
    kind: string,
    inputHash: string,
    exec: () => Promise<VisionTokenResult>
  ) => Promise<VisionTokenResult>;
};

/**
 * Builds region checkpoint replay/record helpers for processWithRegionDetection.
 * @param resumeFromFailed - true when prior run failed and fingerprint matched checkpoint on disk
 */
export function createRegionCheckpointHandlers(
  sessionId: string,
  fingerprint: string,
  checkpoint: TranscriptGenCheckpoint,
  resumeFromFailed: boolean
): RegionCheckpointHandlers {
  if (!checkpoint.region) {
    checkpoint.region = { ops: [] };
  }
  const ops = checkpoint.region.ops;
  let nextIndex = 0;

  async function persist(): Promise<void> {
    checkpoint.fingerprint = fingerprint;
    checkpoint.mode = "region";
    checkpoint.version = TRANSCRIPT_CHECKPOINT_VERSION;
    await saveTranscriptCheckpoint(sessionId, checkpoint);
  }

  return {
    async tryReplayOrRun(kind, inputHash, exec) {
      const next = ops[nextIndex];
      if (resumeFromFailed && next) {
        if (next.kind === kind && next.inputHash === inputHash) {
          nextIndex++;
          return {
            text: next.text,
            promptTokens: next.promptTokens,
            completionTokens: next.completionTokens,
          };
        }
        throw new TranscriptCheckpointMismatchError(
          `Transcript checkpoint mismatch at op ${nextIndex}: expected kind=${next.kind} hash=${next.inputHash.slice(0, 8)}…, got kind=${kind} hash=${inputHash.slice(0, 8)}…`
        );
      }

      const result = await exec();
      ops.push({
        kind,
        inputHash,
        text: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      await persist();
      return result;
    },
  };
}
