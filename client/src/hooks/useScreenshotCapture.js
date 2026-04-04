import { useState, useEffect, useRef, useCallback } from "react";
import { captureFrameFromStream, enforceMaxSize } from "@/lib/captureUtils";

/**
 * Periodically captures PNG frames from one or more MediaStreams.
 * Frames accumulate in a queue and are drained via consumeFrames().
 *
 * @param {Array<{stream: MediaStream, screenIndex: number}>} streams
 * @param {object} options
 * @param {number} options.intervalMs - Capture interval (default 5000)
 * @param {boolean} options.enabled - Whether capturing is active
 * @returns {{
 *   frameQueue: Array<{blob: Blob, screenIndex: number, capturedAt: number, width: number, height: number}>,
 *   consumeFrames: () => Array,
 *   frameCount: number,
 * }}
 */
export default function useScreenshotCapture(streams, { intervalMs = 5000, enabled = true } = {}) {
  const [frameCount, setFrameCount] = useState(0);
  const queueRef = useRef([]);
  const intervalRef = useRef(null);

  const captureAll = useCallback(async () => {
    if (!streams || streams.length === 0) return;

    for (const { stream, screenIndex } of streams) {
      try {
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== "live") continue;

        const { blob, width, height } = await captureFrameFromStream(stream);
        const safeBob = await enforceMaxSize(blob);

        const frame = {
          blob: safeBob,
          screenIndex,
          capturedAt: Date.now(),
          width,
          height,
        };

        queueRef.current.push(frame);
        setFrameCount((c) => c + 1);
      } catch (err) {
        console.warn(`Frame capture failed for screen ${screenIndex}:`, err.message);
      }
    }
  }, [streams]);

  useEffect(() => {
    if (!enabled || !streams || streams.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Capture immediately, then at interval
    captureAll();
    intervalRef.current = setInterval(captureAll, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, streams, intervalMs, captureAll]);

  const consumeFrames = useCallback(() => {
    const frames = [...queueRef.current];
    queueRef.current = [];
    return frames;
  }, []);

  return {
    frameQueue: queueRef.current,
    consumeFrames,
    frameCount,
  };
}
