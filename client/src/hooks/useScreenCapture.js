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
  // Ring population is unconditional: when a track dies in production the ring
  // is persisted onto the `stream_lost` sidecar event, and that only helps if
  // it was being filled. Only the console noise stays behind the debug flag.
  if (globalDebugHooksInstalled) return;
  globalDebugHooksInstalled = true;

  const log = (tag, detail = {}) => {
    pushScreenCaptureContextEvent(tag, detail);
    if (!isScreenShareDebugEnabled()) return;
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
 * How long after an app-initiated track.stop() a subsequent `ended` event is
 * still attributed to us. A microtask was too short: the spec says stop() does
 * not fire `ended`, but any engine that does fire it dispatches it as a task,
 * by which point a microtask-scoped flag has already been cleared — and a
 * cleared flag routes submit/navigation teardown into the "stream lost" path.
 */
const INTERNAL_STOP_GRACE_MS = 2000;

/**
 * Hook to manage screen capture MediaStream(s).
 * Supports single or multiple screens.
 *
 * @returns {{
 *   streams: Array<{stream: MediaStream, screenIndex: number, label: string, displaySurface: string | null}>,
 *   isSharing: boolean,
 *   isSharingFullScreen: boolean,
 *   displaySurface: string | null,
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
  const [error, setError] = useState(null);
  const [streamLost, setStreamLost] = useState(false);
  const streamLostCallbackRef = useRef(null);
  const streamRestoredCallbackRef = useRef(null);
  /** Mirrors `streamLost` synchronously — render state is too late to gate on. */
  const streamLostRef = useRef(false);
  /**
   * Authoritative, synchronous copy of `streams`. State lags by a render, and
   * teardown/add paths run inside async handlers where a stale closure would
   * either miss a live track or resurrect a dead one.
   */
  const streamsRef = useRef([]);
  /** Timestamp until which track.stop() calls are attributed to the app. */
  const internalStopUntilRef = useRef(0);

  /** Single writer for both the ref and the state, so they never diverge. */
  const commitStreams = useCallback((next) => {
    streamsRef.current = next;
    setStreams(next);
  }, []);

  useEffect(() => {
    installGlobalScreenShareDebugHooksOnce();
  }, []);

  const addStreamInternal = useCallback(async (screenIndex) => {
    try {
      installGlobalScreenShareDebugHooksOnce();

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });

      const track = mediaStream.getVideoTracks()[0];
      const label = track.label || `Screen ${screenIndex + 1}`;
      const settings = track.getSettings();
      const displaySurface = settings.displaySurface || null;

      // Window/tab shares are accepted so we can ask them to reshare a monitor.
      if (displaySurface && displaySurface !== "monitor") {
        console.warn(
          `Screen share is ${displaySurface}, not a full monitor. Accepting anyway.`
        );
      }

      pushScreenCaptureContextEvent("capture_started", {
        label: track.label,
        displaySurface,
      });
      if (isScreenShareDebugEnabled()) {
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

        const stoppedByApp = Date.now() < internalStopUntilRef.current;

        pushScreenCaptureContextEvent("video_track_ended", {
          stoppedByApp,
          label: track.label,
          displaySurface: settings.displaySurface,
        });

        if (isScreenShareDebugEnabled()) {
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

        // A stream we no longer track was already torn down by the app
        // (stopCapture / unmount). Late `ended` events from those must never be
        // reported as a loss, however long after the stop they arrive.
        const wasTracked = streamsRef.current.some(
          (s) => s.stream === mediaStream
        );
        commitStreams(
          streamsRef.current.filter((s) => s.stream !== mediaStream)
        );

        if (stoppedByApp || !wasTracked) {
          return;
        }

        // Already in the lost state (multi-monitor: second track ending) — do
        // not raise a second loss until sharing has actually come back.
        if (streamLostRef.current) return;
        streamLostRef.current = true;
        setStreamLost(true);
        // Browsers give no reason code for an ended track. Hand the consumer
        // everything there is: the track's identity and the recent page-event
        // ring, so the loss can be persisted with its correlation attached
        // instead of depending on someone watching the console.
        streamLostCallbackRef.current?.({
          label: track.label,
          displaySurface: settings.displaySurface ?? null,
          visibilityState: document.visibilityState,
          documentHasFocus:
            typeof document.hasFocus === "function" ? document.hasFocus() : null,
          contextRing: contextEventRing.map((e) => ({
            atIso: e.atIso,
            tag: e.tag,
            visibilityState: e.visibilityState,
            hasFocus: e.hasFocus,
          })),
        });
      });

      const entry = { stream: mediaStream, screenIndex, label, displaySurface };
      // Fire the restore transition here, imperatively. It used to live in an
      // effect gated on `streams.length > 0 && streamLost`, but React 18
      // auto-batches these two updates: the render where streams is non-empty
      // AND streamLost is still true never happens, so the effect early-returned
      // and the restored callback (and its `stream_restored` sidecar event)
      // never fired.
      const wasLost = streamLostRef.current;
      streamLostRef.current = false;
      commitStreams([...streamsRef.current, entry]);
      setError(null);
      setStreamLost(false);
      if (wasLost) {
        streamRestoredCallbackRef.current?.();
      }

      return mediaStream;
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError("Screen share permission was denied");
      } else {
        setError(err.message || "Failed to start screen capture");
      }
      return null;
    }
  }, [commitStreams]);

  const startCapture = useCallback(async () => {
    const stream = await addStreamInternal(0);
    return stream;
  }, [addStreamInternal]);

  const addStream = useCallback(async () => {
    const nextIndex = streamsRef.current.length;
    await addStreamInternal(nextIndex);
  }, [addStreamInternal]);

  const stopCapture = useCallback(() => {
    internalStopUntilRef.current = Date.now() + INTERNAL_STOP_GRACE_MS;
    streamsRef.current.forEach(({ stream }) => {
      stream.getTracks().forEach((t) => t.stop());
    });
    streamLostRef.current = false;
    commitStreams([]);
    setStreamLost(false);
  }, [commitStreams]);

  const onStreamLost = useCallback((cb) => {
    streamLostCallbackRef.current = cb;
  }, []);

  const onStreamRestored = useCallback((cb) => {
    streamRestoredCallbackRef.current = cb;
  }, []);

  // Cleanup on unmount ONLY. This used to be keyed on `[streams]`, which meant
  // React ran the previous cleanup — stopping every track in the previous array
  // — on every streams change. Adding a second monitor therefore killed the
  // first one's track, and any array churn could kill a live share.
  useEffect(() => {
    return () => {
      internalStopUntilRef.current = Date.now() + INTERNAL_STOP_GRACE_MS;
      streamsRef.current.forEach(({ stream }) => {
        stream.getTracks().forEach((t) => t.stop());
      });
      streamsRef.current = [];
    };
  }, []);

  // Derived, never stored: a track that ended externally leaves `streams` empty,
  // and a stored `isSharing` flag stayed true through that — which let the setup
  // gate believe a dead share was still valid.
  const isSharing = streams.length > 0;
  const isSharingFullScreen = streams.some(
    (s) => s.displaySurface === "monitor"
  );
  const displaySurface = streams[0]?.displaySurface ?? null;

  return {
    streams,
    isSharing,
    isSharingFullScreen,
    displaySurface,
    error,
    startCapture,
    addStream,
    stopCapture,
    streamLost,
    onStreamLost,
    onStreamRestored,
  };
}
