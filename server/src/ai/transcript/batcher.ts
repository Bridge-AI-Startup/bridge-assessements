import { PreparedFrame } from "../../services/capture/framePrep.js";

export interface FrameBatch {
  frames: PreparedFrame[];
  batchIndex: number;
}

/**
 * Split frames into batches suitable for vision API calls.
 * Default batch size is 2 frames for maximum OCR accuracy.
 * Fewer frames per batch = more tokens available per frame = less truncation.
 *
 * @param frames - Sorted array of prepared frames
 * @param maxBatchSize - Max frames per batch (default 2)
 * @returns Array of frame batches
 */
export function createBatches(
  frames: PreparedFrame[],
  maxBatchSize: number = 2
): FrameBatch[] {
  if (frames.length === 0) return [];

  const batches: FrameBatch[] = [];
  let batchIndex = 0;

  for (let i = 0; i < frames.length; i += maxBatchSize) {
    const batchFrames = frames.slice(i, i + maxBatchSize);

    // Dynamically reduce batch size for very high-res frames (>4K)
    const hasLargeFrames = batchFrames.some(
      (f) => f.width > 3840 || f.height > 2160
    );
    if (hasLargeFrames && batchFrames.length > 3) {
      // Re-split into smaller batches
      for (let j = 0; j < batchFrames.length; j += 3) {
        batches.push({
          frames: batchFrames.slice(j, j + 3),
          batchIndex: batchIndex++,
        });
      }
    } else {
      batches.push({
        frames: batchFrames,
        batchIndex: batchIndex++,
      });
    }
  }

  return batches;
}
