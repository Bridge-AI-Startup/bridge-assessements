import { useState, useEffect, useRef, useCallback } from "react";
import { createVideoRecorder } from "@/lib/captureUtils";
import { uploadVideoChunk } from "@/api/proctoring";

/**
 * Records video from MediaStreams and uploads chunks to the server.
 * Creates one MediaRecorder per stream, uploads chunks every `timesliceMs`.
 *
 * @param {Array<{stream: MediaStream, screenIndex: number}>} streams
 * @param {object} options
 * @param {string} options.sessionId
 * @param {string} options.token
 * @param {boolean} options.enabled
 * @param {number} options.timesliceMs - Chunk interval (default 30000)
 * @returns {{
 *   isRecording: boolean,
 *   chunkCount: number,
 *   uploadedChunks: number,
 *   failedChunks: number,
 *   totalVideoBytes: number,
 *   videoFailed: boolean,
 *   stopRecording: () => Promise<void>,
 * }}
 */
export default function useVideoRecording(
  streams,
  { sessionId, token, enabled = false, timesliceMs = 30000 } = {}
) {
  const [chunkCount, setChunkCount] = useState(0);
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [failedChunks, setFailedChunks] = useState(0);
  const [totalVideoBytes, setTotalVideoBytes] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const recordersRef = useRef([]);
  const startTimesRef = useRef(new Map()); // screenIndex → chunk start time

  const uploadChunk = useCallback(
    async (blob, screenIndex) => {
      if (!sessionId || !token) return;

      const now = Date.now();
      const startTime = startTimesRef.current.get(screenIndex) || now;

      try {
        await uploadVideoChunk(sessionId, token, blob, {
          screenIndex,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(now).toISOString(),
        });
        setUploadedChunks((c) => c + 1);
        setTotalVideoBytes((b) => b + blob.size);
      } catch (err) {
        console.warn(`[video] Upload failed for screen ${screenIndex}:`, err.message);
        setFailedChunks((c) => c + 1);
      }

      // Next chunk starts now
      startTimesRef.current.set(screenIndex, now);
    },
    [sessionId, token]
  );

  // Start/stop recorders when enabled changes
  useEffect(() => {
    if (!enabled || !streams || streams.length === 0 || !sessionId || !token) {
      return;
    }

    // Don't restart if already recording
    if (recordersRef.current.length > 0) return;

    const recorders = [];
    for (const { stream, screenIndex } of streams) {
      try {
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== "live") continue;

        startTimesRef.current.set(screenIndex, Date.now());

        const { recorder, stop } = createVideoRecorder(
          stream,
          timesliceMs,
          (blob) => {
            setChunkCount((c) => c + 1);
            uploadChunk(blob, screenIndex);
          }
        );

        recorder.onerror = (e) => {
          console.error(`[video] MediaRecorder error for screen ${screenIndex}:`, e);
          setVideoFailed(true);
        };

        recorders.push({ recorder, stop, screenIndex });
      } catch (err) {
        console.error(`[video] Failed to start recorder for screen ${screenIndex}:`, err);
        setVideoFailed(true);
      }
    }

    recordersRef.current = recorders;
    if (recorders.length > 0) {
      setIsRecording(true);
      console.log(`[video] Started ${recorders.length} recorder(s)`);
    }

    // Cleanup on unmount only — stopRecording handles normal shutdown
    return () => {
      // Don't auto-stop here; let stopRecording handle it
    };
  }, [enabled, streams, sessionId, token, timesliceMs, uploadChunk]);

  const stopRecording = useCallback(async () => {
    const recorders = recordersRef.current;
    if (recorders.length === 0) return;

    console.log(`[video] Stopping ${recorders.length} recorder(s)...`);

    // Stop all recorders — this triggers final ondataavailable
    const stopPromises = recorders.map(({ stop }) => stop());
    await Promise.all(stopPromises);

    // Small delay to let final chunk uploads fire
    await new Promise((r) => setTimeout(r, 500));

    recordersRef.current = [];
    setIsRecording(false);
    console.log("[video] All recorders stopped");
  }, []);

  return {
    isRecording,
    chunkCount,
    uploadedChunks,
    failedChunks,
    totalVideoBytes,
    videoFailed,
    stopRecording,
  };
}
