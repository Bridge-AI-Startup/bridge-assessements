import { useState, useEffect, useRef, useCallback } from "react";

function isScreenShareDebugEnabled() {
  try {
    if (import.meta.env.DEV) return true;
    return localStorage.getItem("DEBUG_SCREEN_SHARE") === "1";
  } catch {
    return import.meta.env.DEV;
  }
}

let globalDebugHooksInstalled = false;

/** Last N page events (focus, visibility, etc.) for correlation — browsers never say *why* a track ended. */
const CONTEXT_RING_MAX = 30;
const contextEventRing = [];

function pushScreenCaptureContextEvent(tag, extra = {}) {
  const row = {
    atMs: Date.now(),
    atIso: new Date().toISOString(),
    tag,
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
    ...extra,
  };
  contextEventRing.push(row);
  while (contextEventRing.length > CONTEXT_RING_MAX) contextEventRing.shift();
}

function installGlobalScreenShareDebugHooksOnce() {
  if (globalDebugHooksInstalled || !isScreenShareDebugEnabled()) return;
  globalDebugHooksInstalled = true;

  const log = (tag, detail = {}) => {
    pushScreenCaptureContextEvent(tag, detail);
    console.warn(`[screen-capture][ctx] ${tag}`, {
      t: new Date().toISOString(),
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      ...detail,
    });
  };

  document.addEventListener("visibilitychange", () => log("visibilitychange"), {
    passive: true,
  });
  window.addEventListener("pagehide", (e) => log("pagehide", { persisted: e.persisted }), {
    passive: true,
  });
  window.addEventListener("blur", () => log("window_blur"), { passive: true });
  window.addEventListener("focus", () => log("window_focus"), { passive: true });
  window.addEventListener("offline", () => log("offline"), { passive: true });
  window.addEventListener("online", () => log("online"), { passive: true });
}

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
  /** True while we are calling track.stop() from stopCapture or unmount cleanup. */
  const internalStopRef = useRef(false);

  useEffect(() => {
    installGlobalScreenShareDebugHooksOnce();
  }, []);

  const addStreamInternal = useCallback(async (screenIndex) => {
    try {
      if (isScreenShareDebugEnabled()) installGlobalScreenShareDebugHooksOnce();

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

      if (isScreenShareDebugEnabled()) {
        pushScreenCaptureContextEvent("capture_started", {
          label: track.label,
          settings: track.getSettings ? track.getSettings() : {},
        });
        console.warn("[screen-capture] capture started", {
          label: track.label,
          settings: track.getSettings ? track.getSettings() : {},
        });
      }

      track.addEventListener("mute", () => {
        if (isScreenShareDebugEnabled()) {
          console.warn("[screen-capture] video track muted", {
            label: track.label,
            readyState: track.readyState,
          });
        }
      });

      track.addEventListener("ended", () => {
        let settings = {};
        try {
          settings = track.getSettings ? track.getSettings() : {};
        } catch {
          /* ignore */
        }

        const stoppedByApp = internalStopRef.current;

        if (isScreenShareDebugEnabled()) {
          pushScreenCaptureContextEvent("video_track_ended", {
            stoppedByApp,
            label: track.label,
            displaySurface: settings.displaySurface,
          });

          const summary =
            `stoppedByApp=${stoppedByApp} | visibility=${document.visibilityState} | hidden=${document.hidden} | ` +
            `document.hasFocus=${typeof document.hasFocus === "function" ? document.hasFocus() : "?"} | ` +
            `label=${track.label} | displaySurface=${settings.displaySurface ?? "unknown"}`;

          // Loud + copy-paste friendly (expanded objects are easy to miss).
          if (stoppedByApp) {
            console.warn("[screen-capture] video track ended (app requested stop — e.g. submit/navigation)\n" + summary);
          } else {
            console.error(
              "\n%c SCREEN SHARE STOPPED (browser ended the track)",
              "background:#b45309;color:#fff;font-size:11px;padding:3px 6px;border-radius:3px;",
              "\nWeb APIs do not expose a reason code — only correlation below.\n",
              summary,
              "\n\nRecent context (newest at bottom):",
              contextEventRing,
              {
                track: {
                  label: track.label,
                  readyState: track.readyState,
                  muted: track.muted,
                  settings,
                },
                page: {
                  visibilityState: document.visibilityState,
                  hidden: document.hidden,
                  documentHasFocus:
                    typeof document.hasFocus === "function" ? document.hasFocus() : undefined,
                },
              },
            );
          }
        }

        setStreams((prev) => prev.filter((s) => s.stream !== mediaStream));

        if (stoppedByApp) {
          return;
        }

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
    internalStopRef.current = true;
    streams.forEach(({ stream }) => {
      stream.getTracks().forEach((t) => t.stop());
    });
    setStreams([]);
    setIsSharing(false);
    queueMicrotask(() => {
      internalStopRef.current = false;
    });
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
      internalStopRef.current = true;
      streams.forEach(({ stream }) => {
        stream.getTracks().forEach((t) => t.stop());
      });
      queueMicrotask(() => {
        internalStopRef.current = false;
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
