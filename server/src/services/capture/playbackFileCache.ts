import fs from "fs/promises";

import type { IFrameStorage } from "./storage.js";
import { buildSessionWebmForPlayback } from "./sessionVideoMerge.js";

type CachedPlaybackFile = {
  filePath: string;
  size: number;
  cleanup: () => Promise<void>;
  expiresAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CachedPlaybackFile>();

async function evictExpired(): Promise<void> {
  const now = Date.now();
  for (const [sessionId, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(sessionId);
      await entry.cleanup().catch(() => {});
    }
  }
}

export type PlaybackSource =
  | {
      type: "storage";
      storage: IFrameStorage;
      key: string;
      size: number;
    }
  | {
      type: "file";
      filePath: string;
      size: number;
    };

/**
 * Resolve a seekable playback source for HTTP Range streaming.
 * Reuses a temp merged file across concurrent range requests (on-demand merge path).
 */
export async function resolvePlaybackSource(
  sessionId: string,
  session: Parameters<typeof buildSessionWebmForPlayback>[1],
  storage: IFrameStorage
): Promise<PlaybackSource | null> {
  await evictExpired();

  const merged = session.mergedVideo as
    | { status?: string; storageKey?: string | null }
    | undefined;

  if (
    merged?.status === "ready" &&
    merged.storageKey &&
    (await storage.exists(merged.storageKey))
  ) {
    const size = await storage.getObjectSize(merged.storageKey);
    return { type: "storage", storage, key: merged.storageKey, size };
  }

  const cached = cache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    return { type: "file", filePath: cached.filePath, size: cached.size };
  }

  if (cached) {
    cache.delete(sessionId);
    await cached.cleanup().catch(() => {});
  }

  const result = await buildSessionWebmForPlayback(sessionId, session, storage);
  if (!result) return null;

  const st = await fs.stat(result.filePath);
  cache.set(sessionId, {
    filePath: result.filePath,
    size: st.size,
    cleanup: result.cleanup,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { type: "file", filePath: result.filePath, size: st.size };
}
