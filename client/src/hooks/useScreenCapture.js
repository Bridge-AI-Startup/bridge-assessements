import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Hook to manage screen capture MediaStream(s).
 * Supports single or multiple screens.
 *
 * @returns {{
 *   streams: Array<{stream: MediaStream, screenIndex: number, label: string}>,
 *   isSharing: boolean,
 *   error: string | null,
 *   startCapture: () => Promise<MediaStream>,
 *   addStream: () => Promise<void>,
 *   stopCapture: () => void,
 *   streamLost: boolean,
 *   onStreamLost: (callback: () => void) => void,
 *   onStreamRestored: (callback: () => void) => void,
 * }}
 */
export default function useScreenCapture() {
  const [streams, setStreams] = useState([]);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState(null);
  const [streamLost, setStreamLost] = useState(false);
  const streamLostCallbackRef = useRef(null);
  const streamRestoredCallbackRef = useRef(null);

  const addStreamInternal = useCallback(async (screenIndex) => {
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });

      const track = mediaStream.getVideoTracks()[0];
      const label = track.label || `Screen ${screenIndex + 1}`;
      const settings = track.getSettings();

      // Validate it's a full screen share, not a tab/window
      if (settings.displaySurface && settings.displaySurface !== "monitor") {
        console.warn(
          `Screen share is ${settings.displaySurface}, not a full monitor. Accepting anyway.`
        );
      }

      // Listen for track ended
      track.addEventListener("ended", () => {
        setStreams((prev) => prev.filter((s) => s.stream !== mediaStream));
        setStreamLost(true);
        streamLostCallbackRef.current?.();
      });

      const entry = { stream: mediaStream, screenIndex, label };
      setStreams((prev) => [...prev, entry]);
      setIsSharing(true);
      setError(null);
      setStreamLost(false);

      return mediaStream;
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError("Screen share permission was denied");
      } else {
        setError(err.message || "Failed to start screen capture");
      }
      return null;
    }
  }, []);

  const startCapture = useCallback(async () => {
    const stream = await addStreamInternal(0);
    return stream;
  }, [addStreamInternal]);

  const addStream = useCallback(async () => {
    const nextIndex = streams.length;
    await addStreamInternal(nextIndex);
  }, [streams.length, addStreamInternal]);

  const stopCapture = useCallback(() => {
    streams.forEach(({ stream }) => {
      stream.getTracks().forEach((t) => t.stop());
    });
    setStreams([]);
    setIsSharing(false);
  }, [streams]);

  const onStreamLost = useCallback((cb) => {
    streamLostCallbackRef.current = cb;
  }, []);

  const onStreamRestored = useCallback((cb) => {
    streamRestoredCallbackRef.current = cb;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streams.forEach(({ stream }) => {
        stream.getTracks().forEach((t) => t.stop());
      });
    };
  }, [streams]);

  // Detect when stream is restored after being lost
  useEffect(() => {
    if (streams.length > 0 && !streamLost) {
      return;
    }
    if (streams.length > 0 && streamLost) {
      setStreamLost(false);
      streamRestoredCallbackRef.current?.();
    }
  }, [streams.length, streamLost]);

  return {
    streams,
    isSharing,
    error,
    startCapture,
    addStream,
    stopCapture,
    streamLost,
    onStreamLost,
    onStreamRestored,
  };
}
