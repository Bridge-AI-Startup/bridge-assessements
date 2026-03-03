import { useState, useRef, useCallback } from "react";
import { computePixelDiff, blobToImageData } from "@/lib/captureUtils";

/**
 * Client-side frame deduplication using pixel-diff comparison.
 * Compares each new frame against the last accepted frame per screen.
 * Skips frames where difference is below threshold.
 *
 * @param {object} options
 * @param {number} options.threshold - Pixel diff threshold (default 0.03 = 3%)
 * @returns {{
 *   shouldKeepFrame: (blob: Blob, screenIndex: number) => Promise<boolean>,
 *   duplicatesSkipped: number,
 * }}
 */
export default function useFrameDedup({ threshold = 0.03 } = {}) {
  const [duplicatesSkipped, setDuplicatesSkipped] = useState(0);
  const lastImageDataRef = useRef(new Map()); // screenIndex → ImageData

  const shouldKeepFrame = useCallback(
    async (blob, screenIndex) => {
      try {
        const currentData = await blobToImageData(blob);
        const lastData = lastImageDataRef.current.get(screenIndex);

        if (!lastData) {
          // First frame for this screen — always keep
          lastImageDataRef.current.set(screenIndex, currentData);
          return true;
        }

        const diff = computePixelDiff(lastData, currentData);
        if (diff < threshold) {
          setDuplicatesSkipped((c) => c + 1);
          return false;
        }

        lastImageDataRef.current.set(screenIndex, currentData);
        return true;
      } catch (err) {
        console.warn("Dedup comparison failed, keeping frame:", err.message);
        return true;
      }
    },
    [threshold]
  );

  return {
    shouldKeepFrame,
    duplicatesSkipped,
  };
}
