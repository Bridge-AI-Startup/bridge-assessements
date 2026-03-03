import { useState, useEffect, useRef, useCallback } from "react";
import { uploadFrame } from "@/api/proctoring";

/**
 * Batched frame upload hook with retry logic.
 * Consumes frames from a provider callback and uploads them.
 *
 * @param {object} options
 * @param {string} options.sessionId - Proctoring session ID
 * @param {string} options.token - Submission token
 * @param {() => Array} options.consumeFrames - Function to drain frame queue
 * @param {boolean} options.enabled - Whether uploading is active
 * @param {number} options.flushIntervalMs - How often to flush (default 10000)
 * @param {number} options.maxRetries - Max retries per frame (default 3)
 */
export default function useFrameUpload({
  sessionId,
  token,
  consumeFrames,
  enabled = true,
  flushIntervalMs = 10000,
  maxRetries = 3,
} = {}) {
  const [uploadedCount, setUploadedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const intervalRef = useRef(null);
  const uploadingRef = useRef(false);

  const flush = useCallback(async () => {
    if (!sessionId || !token || !consumeFrames || uploadingRef.current) return;

    const frames = consumeFrames();
    if (frames.length === 0) return;

    uploadingRef.current = true;
    setIsUploading(true);

    for (const frame of frames) {
      let success = false;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const result = await uploadFrame(sessionId, token, frame.blob, {
          screenIndex: frame.screenIndex,
          capturedAt: frame.capturedAt,
          width: frame.width,
          height: frame.height,
        });

        if (result.success) {
          setUploadedCount((c) => c + 1);
          success = true;
          break;
        }

        // Exponential backoff
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }

      if (!success) {
        setFailedCount((c) => c + 1);
        console.warn("Frame upload failed after retries, dropping frame");
      }
    }

    uploadingRef.current = false;
    setIsUploading(false);
  }, [sessionId, token, consumeFrames, maxRetries]);

  useEffect(() => {
    if (!enabled || !sessionId || !token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(flush, flushIntervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, sessionId, token, flushIntervalMs, flush]);

  return {
    uploadedCount,
    failedCount,
    isUploading,
    flush, // Expose for manual flush (e.g., beforeunload)
  };
}
