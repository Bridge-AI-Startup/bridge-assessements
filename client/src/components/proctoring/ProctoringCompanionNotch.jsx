import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Mic, MicOff } from "lucide-react";
import {
  getCompanionPrompt,
  recordCompanionMessages,
  completeCompanion,
  beaconCompanionShutdown,
} from "@/api/proctoring";
import { cn } from "@/lib/utils";

/** Fallback opener if the server response omits `firstMessage`. */
const FALLBACK_FIRST_MESSAGE =
  "You're in. I'm here as a quick check-in so you can talk through what you're doing as you code — it helps capture your thinking. No pressure, and I won't give hints or answers. The assignment is on the page. Follow the setup steps there: unzip the starter if you have one, run the Node command shown, then open your AI assistant in that folder.";

/** Injected on every stream loss so the agent speaks — not a candidate transcript line. */
const SCREEN_SHARE_LOST_UPDATE =
  "The candidate's screen share just stopped (or needs to be resumed after a refresh). Speak now — do not skip this turn. Tell them they must reshare their entire screen: the full display, not a window or a browser tab. They cannot continue the assessment without sharing. Keep it to one or two sentences. If a later update says sharing was restored, that supersedes this one.";

/**
 * Injected when sharing comes back, so the agent's world model unlatches. A
 * contextual update does not force a turn, so the loss update above is often
 * spoken seconds AFTER the candidate has already reshared (observed live:
 * restore at 15:35:13, nag spoken 15:35:19, then four more turns of "I can't
 * see your screen" against a healthy share). Without this positive signal the
 * agent has no way to learn the loss is over — the candidate saying "it should
 * be shared" is not evidence it can trust.
 */
const SCREEN_SHARE_RESTORED_UPDATE =
  "The candidate's screen share has been RESTORED — they are sharing their entire screen again. This supersedes any earlier screen-share-lost update. Stop asking them to reshare. If your very last message asked them to reshare, briefly acknowledge they're all set in a few words; otherwise say nothing about screen sharing. Never claim you cannot see their screen.";

/** How often buffered transcript lines are POSTed to the server. */
const FLUSH_INTERVAL_MS = 10000;
/** Mic/agent level sampling for the meter. Cheap enough at 12fps, written straight to the DOM. */
const LEVEL_INTERVAL_MS = 80;
/**
 * The companion must outlive a dropped connection. ElevenLabs ends a conversation
 * on its own `max_duration_seconds` cap and on any transport blip; without a
 * restart the candidate silently loses the voice check-in for the rest of a
 * multi-hour assessment (assessments here run up to 240 minutes).
 */
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 12;
/**
 * Proactive pulse. ElevenLabs only gives the agent LLM a turn when the
 * candidate speaks or the silence turn-timeout fires — and `skip_turn`
 * (which the prompt makes the default) mutes the agent "until the user
 * speaks again", cancelling that timeout. Observed live 2026-08-19: a
 * 105-second silence produced zero agent turns while the timeline filled
 * with Claude Code activity the agent is prompted to ask about. So the
 * client grants the turn instead: after PULSE_INTERVAL_MS with no real
 * voice activity, send a sentinel user message. The prompt tells the agent
 * a "[pulse]" message is an automated cadence signal — poll the timeline,
 * ask one anchored question if warranted, else skip_turn. Pulse messages
 * are filtered out of the stored transcript (onMessage drops them), so
 * grading and the communication assessment never see fake candidate speech.
 */
const PULSE_PREFIX = "[pulse]";
const PULSE_TEXT =
  "[pulse] Automated cadence signal — the candidate did not say anything.";
const PULSE_INTERVAL_MS = 120000;
const PULSE_CHECK_MS = 15000;

/**
 * Normalize an ElevenLabs socket event to { role, text, timestampMs }.
 *
 * SDK >= 1.x delivers raw socket events (`user_transcript` / `agent_response`);
 * the flattened `{ message, source }` shape from 0.x is still handled so a
 * downgrade of the SDK doesn't silently stop recording the transcript.
 */
function normalizeMessage(event) {
  if (!event || typeof event !== "object") return null;

  const timestampMs = Date.now();
  const type = (event.type || "").toLowerCase();

  if (type === "user_transcript") {
    const text = event.user_transcription_event?.user_transcript;
    return text?.trim()
      ? { role: "candidate", text: text.trim(), timestampMs }
      : null;
  }
  if (type === "agent_response") {
    const text = event.agent_response_event?.agent_response;
    return text?.trim() ? { role: "agent", text: text.trim(), timestampMs } : null;
  }
  if (type === "agent_response_correction") {
    const text = event.agent_response_correction_event?.corrected_agent_response;
    return text?.trim() ? { role: "agent", text: text.trim(), timestampMs } : null;
  }

  // Legacy flattened shape: { message, source: "ai" | "user" }.
  const text = event.message ?? event.text ?? event.content;
  if (typeof text === "string" && text.trim()) {
    const source = (event.source || event.role || "").toString().toLowerCase();
    const isAgent = ["ai", "agent", "assistant"].includes(source);
    return { role: isAgent ? "agent" : "candidate", text: text.trim(), timestampMs };
  }

  return null;
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Three-bar level meter. Driven by direct style writes from a ref rather than
 * React state — this sits on screen for the whole assessment and must not
 * re-render the page 12 times a second.
 */
function LevelMeter({ barsRef, active }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className={cn(
            "w-[3px] rounded-full transition-colors duration-300",
            active ? "bg-green-300" : "bg-white/25"
          )}
          style={{ height: "3px" }}
        />
      ))}
    </span>
  );
}

const CompanionPanel = forwardRef(function CompanionPanel(
  {
    sessionId,
    token,
    submissionId,
    className,
    reshareRequestId = 0,
    shareRestoredRequestId = 0,
    screenShareLive = false,
  },
  ref
) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const transcriptEndRef = useRef(null);
  const messageBufferRef = useRef([]);
  const startTimeRef = useRef(null);
  const startedRef = useRef(false);
  const endedRef = useRef(false);
  const conversationRef = useRef(null);
  const barsRef = useRef([]);
  const pendingReshareRef = useRef(false);
  const speakResharePromptRef = useRef(() => {});
  /** True once a lost update was actually delivered — only then does a restore need announcing. */
  const lostUpdateDeliveredRef = useRef(false);
  /** Auto-reconnect bookkeeping: attempt counter, pending timer, and the restart fn. */
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const reconnectRef = useRef(null);
  /** Last real (non-pulse) voice activity in either direction; pulses also bump it. */
  const lastVoiceActivityRef = useRef(Date.now());
  /** True while a reconnect is in flight, so onConnect can send the resume update. */
  const reconnectingRef = useRef(false);

  const agentId = import.meta.env?.VITE_ELEVENLABS_AGENT_ID;

  // @elevenlabs/react 1.x: firstMessage must live on startSession overrides
  // (`overrides.agent.firstMessage`). Putting it only on useConversation is not
  // enough — without this field the dashboard default greeting plays instead.
  const buildOverrides = (cfg) => {
    if (!cfg?.prompt) return null;
    return {
      agent: {
        prompt: { prompt: cfg.prompt },
        firstMessage: cfg.firstMessage || FALLBACK_FIRST_MESSAGE,
      },
    };
  };
  const overrides = useMemo(() => buildOverrides(config), [config]);

  /** Mirrors `screenShareLive` so the queued nag can re-check it on connect. */
  const screenShareLiveRef = useRef(screenShareLive);
  screenShareLiveRef.current = screenShareLive;

  const speakResharePrompt = useCallback(() => {
    // Never nag about a share that is already back. The nag is queued when the
    // conversation is not connected yet, and by the time it connects the
    // candidate has often already reshared.
    if (screenShareLiveRef.current) {
      pendingReshareRef.current = false;
      return;
    }
    const conv = conversationRef.current;
    if (!conv || conv.status !== "connected") {
      pendingReshareRef.current = true;
      return;
    }
    pendingReshareRef.current = false;
    try {
      conv.sendContextualUpdate?.(SCREEN_SHARE_LOST_UPDATE);
      lostUpdateDeliveredRef.current = true;
    } catch (err) {
      console.warn("[ProctoringCompanion] reshare contextual update failed:", err);
    }
  }, []);

  /**
   * Tell the agent sharing is back. Only needed when a lost update was actually
   * delivered — a loss that resolved before the agent ever heard about it needs
   * no correction, and injecting restore noise on every resume would invite the
   * agent to comment on plumbing it was never told about.
   */
  const announceShareRestored = useCallback(() => {
    pendingReshareRef.current = false;
    if (!lostUpdateDeliveredRef.current) return;
    const conv = conversationRef.current;
    if (!conv || conv.status !== "connected") return;
    try {
      conv.sendContextualUpdate?.(SCREEN_SHARE_RESTORED_UPDATE);
      lostUpdateDeliveredRef.current = false;
    } catch (err) {
      console.warn(
        "[ProctoringCompanion] restore contextual update failed:",
        err
      );
    }
  }, []);

  useEffect(() => {
    speakResharePromptRef.current = speakResharePrompt;
  }, [speakResharePrompt]);

  const conversation = useConversation({
    micMuted: muted,
    onConnect: () => {
      setError(null);
      reconnectAttemptsRef.current = 0;
      lastVoiceActivityRef.current = Date.now();
      startTimeRef.current = Date.now();
      if (reconnectingRef.current) {
        reconnectingRef.current = false;
        // The new conversation has no memory of the old one — tell the agent
        // this is a resume so it doesn't re-brief or re-ask answered questions.
        try {
          conversationRef.current?.sendContextualUpdate?.(
            "Session resumed after a brief disconnect. The candidate has been working all along; the opening briefing was already given. Do not repeat it, and treat earlier topics as already covered."
          );
        } catch {
          // best-effort context
        }
      }
      if (pendingReshareRef.current) speakResharePromptRef.current();
    },
    // A conversation that ends on its own (duration cap, transport drop) must be
    // restarted — `endedRef` is the only signal that WE hung up on purpose.
    onDisconnect: () => {
      if (endedRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError("Voice check-in disconnected");
        return;
      }
      const attempt = (reconnectAttemptsRef.current += 1);
      const delay = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1)
      );
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (endedRef.current) return;
        void reconnectRef.current?.();
      }, delay);
    },
    onError: (err) => {
      const msg =
        err && typeof err === "object" && err.message
          ? err.message
          : err
            ? String(err)
            : "Voice check-in disconnected";
      console.error("[ProctoringCompanion] onError:", err);
      setError(msg);
    },
    onMessage: (event) => {
      const normalized = normalizeMessage(event);
      if (!normalized) return;
      // Pulse sentinels are ours, not the candidate's — keep them out of the
      // visible transcript and the stored record that grading reads.
      if (
        typeof normalized.text === "string" &&
        normalized.text.startsWith(PULSE_PREFIX)
      )
        return;
      lastVoiceActivityRef.current = Date.now();
      setTranscript((prev) => [...prev, normalized]);
      messageBufferRef.current.push(normalized);
    },
  });

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  /** POST whatever is buffered. On failure the lines go back in the buffer for the next tick. */
  const flushBuffer = useCallback(async () => {
    const buf = messageBufferRef.current;
    if (buf.length === 0 || !sessionId || !token) return;
    messageBufferRef.current = [];
    try {
      const conversationId = conversationRef.current?.getId?.() || undefined;
      const result = await recordCompanionMessages(
        sessionId,
        token,
        conversationId,
        buf
      );
      if (!result.success) messageBufferRef.current.unshift(...buf);
    } catch (err) {
      console.warn("[ProctoringCompanion] Flush failed:", err);
      messageBufferRef.current.unshift(...buf);
    }
  }, [sessionId, token]);

  // Load the server-side prompt (assessment-aware, no hints).
  useEffect(() => {
    if (!sessionId || !token || !agentId) return undefined;
    let cancelled = false;
    (async () => {
      const result = await getCompanionPrompt(sessionId, token);
      if (cancelled) return;
      if (!result.success) {
        setError(result.error || "Could not start the voice check-in");
        return;
      }
      setConfig(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, token, agentId]);

  // Start the conversation once the prompt is in hand. Runs exactly once.
  /**
   * Open the voice session. Used both for the initial start and by
   * auto-reconnect, so it must stay safe to call more than once.
   * `overridesArg` lets the reconnect path pass a freshly fetched prompt
   * instead of the stale mount-time one.
   */
  const startConversation = useCallback(async (overridesArg) => {
    const effectiveOverrides = overridesArg || overrides;
    if (!effectiveOverrides || !agentId || endedRef.current) return;

    try {
      // Ask for the mic ourselves first: the SDK's own failure is opaque, and
      // "denied" is the one error the candidate can actually act on. Tracks are
      // released immediately — the permission grant is what we're after.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (e) {
      startedRef.current = false;
      setError(
        e?.name === "NotAllowedError"
          ? "Microphone access denied — allow the mic to talk through your work"
          : "No microphone available"
      );
      return;
    }

    try {
      const conv = conversationRef.current;
      if (!conv?.startSession) {
        startedRef.current = false;
        setError("Could not start the voice check-in");
        return;
      }
      conv.startSession({
        agentId,
        connectionType: "webrtc",
        overrides: effectiveOverrides,
        dynamicVariables:
          submissionId != null && submissionId !== ""
            ? { submissionId: String(submissionId) }
            : undefined,
      });
    } catch (e) {
      startedRef.current = false;
      console.error("[ProctoringCompanion] startSession error:", e);
      setError(e?.message || "Could not start the voice check-in");
    }
  }, [overrides, agentId, submissionId]);

  /**
   * Reconnect = resume, not a fresh interview. A new ElevenLabs conversation
   * has no memory of the old one, and the mount-time overrides carry the full
   * opening briefing — replaying it mid-assessment is the "repeated its whole
   * opener" failure the prompt bans. So refetch the prompt first: the server
   * returns a short welcome-back once `companion.status` is active. If the
   * refetch fails, the stale overrides are still better than no companion.
   */
  const reconnect = useCallback(async () => {
    let freshOverrides = null;
    if (sessionId && token) {
      try {
        const result = await getCompanionPrompt(sessionId, token);
        if (result.success && result.data?.prompt) {
          setConfig(result.data);
          freshOverrides = buildOverrides(result.data);
        }
      } catch {
        // fall through to stale overrides
      }
    }
    reconnectingRef.current = true;
    await startConversation(freshOverrides);
  }, [sessionId, token, startConversation]);

  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);

  // Initial start, once the prompt is in hand. Restarts go through onDisconnect.
  useEffect(() => {
    if (!overrides || !agentId || startedRef.current) return;
    startedRef.current = true;
    void startConversation();
  }, [overrides, agentId, startConversation]);

  // Periodic flush.
  useEffect(() => {
    if (!sessionId || !token) return undefined;
    const id = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sessionId, token, flushBuffer]);

  // Proactive pulse: grant the agent a turn during long candidate silence
  // (see PULSE_TEXT above — skip_turn otherwise mutes it indefinitely).
  useEffect(() => {
    const id = setInterval(() => {
      if (endedRef.current) return;
      const conv = conversationRef.current;
      if (!conv || conv.status !== "connected" || conv.isSpeaking) return;
      if (Date.now() - lastVoiceActivityRef.current < PULSE_INTERVAL_MS) return;
      try {
        conv.sendUserMessage?.(PULSE_TEXT);
        // A pulse counts as activity so the next one is a full interval away,
        // even when the agent answers it with a silent skip_turn.
        lastVoiceActivityRef.current = Date.now();
      } catch (e) {
        console.warn("[ProctoringCompanion] pulse failed:", e);
      }
    }, PULSE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  const connected = conversation.status === "connected";
  const speaking = connected && conversation.isSpeaking;

  // Elapsed clock.
  useEffect(() => {
    if (!connected || !startTimeRef.current) return undefined;
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [connected]);

  // Level meter: agent output while it speaks, candidate mic otherwise.
  useEffect(() => {
    if (!connected) return undefined;
    const id = setInterval(() => {
      const conv = conversationRef.current;
      if (!conv) return;
      let level = 0;
      try {
        if (conv.isSpeaking) level = conv.getOutputVolume?.() ?? 0;
        else if (!muted) level = conv.getInputVolume?.() ?? 0;
      } catch {
        level = 0;
      }
      const scaled = Math.min(1, Math.max(0, level * 3));
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        // Middle bar leads; outer bars trail, so idle reads as a flat line.
        const weight = i === 1 ? 1 : 0.6;
        bar.style.height = `${3 + scaled * weight * 13}px`;
      });
    }, LEVEL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = "3px";
      });
    };
  }, [connected, muted]);

  useEffect(() => {
    if (expanded) transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, expanded]);

  /** Flush + hang up. Idempotent so the parent can call it on submit and on timeout. */
  const endAndFlush = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Set before hanging up so onDisconnect reads it as a deliberate end.
    clearTimeout(reconnectTimerRef.current);
    await flushBuffer();
    try {
      conversationRef.current?.endSession?.();
    } catch {
      // already closed
    }
    if (sessionId && token) {
      try {
        await completeCompanion(sessionId, token);
      } catch {
        // best-effort status update
      }
    }
  }, [flushBuffer, sessionId, token]);

  useEffect(() => {
    if (!reshareRequestId) return;
    speakResharePrompt();
    // Deliberately keyed on the tick alone: re-running when `screenShareLive`
    // flips back to true would re-fire the nag after a successful reshare.
    // (`speakResharePrompt` is a stable useCallback with no deps.)
  }, [reshareRequestId]);

  // Sharing came back before the queued nag went out — drop it.
  useEffect(() => {
    if (screenShareLive) pendingReshareRef.current = false;
  }, [screenShareLive]);

  useEffect(() => {
    if (!shareRestoredRequestId) return;
    announceShareRestored();
    // Keyed on the tick alone, like the reshare effect above.
    // (`announceShareRestored` is a stable useCallback with no deps.)
  }, [shareRestoredRequestId]);

  useImperativeHandle(
    ref,
    () => ({ endAndFlush, notifyScreenShareLost: speakResharePrompt }),
    [endAndFlush, speakResharePrompt]
  );

  // Unmount (navigate away, tab close): flush what we have and close the socket.
  // Held in a ref so the cleanup runs on unmount only — keying the effect on
  // `endAndFlush` itself would hang up the moment its identity changed.
  const endAndFlushRef = useRef(endAndFlush);
  useEffect(() => {
    endAndFlushRef.current = endAndFlush;
  }, [endAndFlush]);
  useEffect(() => {
    return () => {
      void endAndFlushRef.current?.();
    };
  }, []);

  // Tab close / refresh: sendBeacon so the last lines and hang-up outlive the page.
  useEffect(() => {
    if (!sessionId || !token) return undefined;
    const onPageHide = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      const buf = messageBufferRef.current;
      messageBufferRef.current = [];
      beaconCompanionShutdown(
        sessionId,
        token,
        conversationRef.current?.getId?.() || undefined,
        buf
      );
      try {
        conversationRef.current?.endSession?.();
      } catch {
        /* already closed */
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [sessionId, token]);

  if (!agentId) return null;

  const statusLabel = error
    ? "Unavailable"
    : speaking
      ? "Speaking"
      : muted && connected
        ? "Muted"
        : connected
          ? "Listening"
          : "Connecting";

  const lastLine = transcript.length ? transcript[transcript.length - 1] : null;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40",
        "w-[min(22rem,calc(100vw-2rem))]",
        className
      )}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        className={cn(
          "overflow-hidden rounded-card border bg-ink text-cream shadow-xl",
          speaking ? "border-green-300/40" : "border-white/10"
        )}
      >
        {/* Header — always visible */}
        <div className="flex items-center gap-3 px-4 py-3">
          <LevelMeter barsRef={barsRef} active={connected && !error} />

          <div className="min-w-0 flex-1">
            <p className="eyebrow text-[11px] leading-none text-cream/55">
              Voice check-in
            </p>
            <p
              className={cn(
                "mt-1 truncate text-[13px] leading-none",
                error ? "text-red-300" : "text-cream/85"
              )}
            >
              {statusLabel}
            </p>
          </div>

          {connected && (
            <span className="font-mono text-xs tabular-nums text-cream/50">
              {formatElapsed(elapsedSec)}
            </span>
          )}

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            disabled={!connected}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-30",
              muted
                ? "bg-red-400/15 text-red-300 hover:bg-red-400/25"
                : "text-cream/60 hover:bg-white/10 hover:text-cream"
            )}
          >
            {muted ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-controls="companion-transcript"
            aria-label={expanded ? "Hide transcript" : "Show transcript"}
            className="rounded-full p-1.5 text-cream/60 transition-colors hover:bg-white/10 hover:text-cream"
          >
            <motion.span
              animate={{ rotate: expanded ? 0 : 180 }}
              transition={{ duration: 0.2 }}
              className="block"
            >
              <ChevronDown className="h-4 w-4" />
            </motion.span>
          </button>
        </div>

        {/* Collapsed preview: the most recent line, so the candidate can glance without expanding */}
        {!expanded && (lastLine || error) && (
          <div className="border-t border-white/10 px-4 py-2.5">
            <p
              className="line-clamp-2 text-[13px] leading-snug text-cream/70"
              title={error || lastLine?.text}
            >
              {error || lastLine?.text}
            </p>
          </div>
        )}

        {/* Expanded transcript */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="transcript"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="border-t border-white/10"
            >
              <div
                id="companion-transcript"
                role="log"
                aria-live="polite"
                className="max-h-64 space-y-2 overflow-y-auto px-4 py-3"
              >
                {error && (
                  <p className="text-[13px] leading-snug text-red-300">{error}</p>
                )}
                {!error && transcript.length === 0 && (
                  <p className="text-[13px] leading-snug text-cream/45">
                    {connected
                      ? "Say what you're working on and it will show up here."
                      : "Connecting to your voice check-in…"}
                  </p>
                )}
                {transcript.map((entry, i) => (
                  <div key={i} className="text-[13px] leading-snug">
                    <span
                      className={cn(
                        "eyebrow mr-2 text-[10px]",
                        entry.role === "agent" ? "text-cream/50" : "text-green-300"
                      )}
                    >
                      {entry.role === "agent" ? "Bridge" : "You"}
                    </span>
                    <span className="whitespace-pre-wrap break-words text-cream/85">
                      {entry.text}
                    </span>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>

              <p className="border-t border-white/10 px-4 py-2.5 text-[11px] leading-snug text-cream/40">
                Talking through your work is recorded with your session. The
                check-in never gives hints or answers.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
});

/**
 * In-session ElevenLabs voice companion.
 *
 * Auto-starts when mounted with a proctoring `sessionId` + candidate `token`:
 * fetches the server-side prompt, opens a WebRTC conversation, and buffers the
 * transcript to `/companion/messages` every 10s. Pass `reshareRequestId` (a
 * monotonically increasing tick) so every stream loss / resume-after-refresh
 * injects a spoken "reshare your entire screen" contextual update, and
 * `screenShareLive` so a nag is dropped rather than spoken once sharing is back.
 * The parent should call `ref.current.endAndFlush()` before completing the
 * proctoring session; `notifyScreenShareLost()` is also on the ref.
 *
 * Renders nothing when `VITE_ELEVENLABS_AGENT_ID` is unset.
 */
const ProctoringCompanionNotch = forwardRef(function ProctoringCompanionNotch(
  props,
  ref
) {
  // useConversation requires a provider ancestor in SDK >= 1.x.
  return (
    <ConversationProvider>
      <CompanionPanel {...props} ref={ref} />
    </ConversationProvider>
  );
});

export default ProctoringCompanionNotch;
