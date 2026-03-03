import crypto from "crypto";

/**
 * Server-side hash-based deduplication.
 * Computes SHA-256 of frame buffers to detect exact duplicates
 * that may have slipped through client-side pixel-diff dedup.
 */

/**
 * Compute a hash for a frame buffer.
 */
export function computeFrameHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Given an array of frames with buffers, mark duplicates based on hash.
 * Returns the same array with `isDuplicate` set on duplicates.
 */
export function deduplicateFrames<
  T extends { buffer: Buffer; screenIndex: number }
>(
  frames: T[]
): (T & { hash: string; isDuplicate: boolean })[] {
  const seen = new Map<string, boolean>(); // hash → first occurrence key (screenIndex+hash)

  return frames.map((frame) => {
    const hash = computeFrameHash(frame.buffer);
    const key = `${frame.screenIndex}:${hash}`;
    const isDuplicate = seen.has(key);
    if (!isDuplicate) {
      seen.set(key, true);
    }
    return { ...frame, hash, isDuplicate };
  });
}
