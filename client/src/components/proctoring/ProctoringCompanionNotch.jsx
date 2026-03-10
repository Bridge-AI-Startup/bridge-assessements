import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useConversation } from "@elevenlabs/react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getCompanionPrompt, recordCompanionMessages } from "@/api/proctoring";
import { cn } from "@/lib/utils";

const COMPANION_FIRST_MESSAGE =
  "You're about to start a coding problem as part of this assessment. I'm here as a quick check-in so you can talk through what you're doing as you code—it helps capture your thinking. I'll ask short questions every so often; just explain what you're working on when I ask. No pressure, and I won't give hints or answers. Ready when you are.";

const FLUSH_INTERVAL_MS = 10000;

/**
 * Normalize ElevenLabs message to { role: "agent" | "candidate", text, timestampMs } for API.
 */
function normalizeMessage(message) {
  if (!message || typeof message !== "object") return null;
  const messageType = (message.type || "").toLowerCase();
  const msgRole = (message.role || "").toString().toLowerCase();
  const msgSpeaker = (message.speaker || "").toString().toLowerCase();
  const msgFrom = (message.from || "").toString().toLowerCase();
  const msgSource = (message.source || "").toString().toLowerCase();
  const text =
    message.text || message.content || message.message || message.data || "";
  if (!text || !String(text).trim()) return null;

  const isAgent =
    messageType === "llm_response" ||
    messageType === "agent_response" ||
    messageType === "agent_speech" ||
    messageType === "assistant" ||
    messageType === "agent" ||
    messageType === "system" ||
    msgRole === "assistant" ||
    msgRole === "agent" ||
    msgRole === "system" ||
    msgSpeaker === "agent" ||
    msgSpeaker === "assistant" ||
    msgFrom === "agent" ||
    msgFrom === "assistant" ||
    msgSource === "agent" ||
    msgSource === "assistant";

  const role = isAgent ? "agent" : "candidate";
  return {
    role,
    text: String(text).trim(),
    timestampMs: Date.now(),
  };
}

/**
 * Notch-style dropdown panel: in-session ElevenLabs voice companion.
 * Auto-starts when mounted with sessionId + token; buffers transcript and flushes to backend every 10s.
 * Parent can call ref.current.endAndFlush() before completing proctoring.
 */
const ProctoringCompanionNotch = forwardRef(function ProctoringCompanionNotch(
  { sessionId, token, submissionId, className },
  ref,
) {
  const [prompt, setPrompt] = useState(null);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const transcriptEndRef = useRef(null);
  const messageBufferRef = useRef([]);
  const conversationIdRef = useRef(null);
  const startTimeRef = useRef(null);
  const flushIntervalRef = useRef(null);
  const startedRef = useRef(false);

  const agentId = import.meta.env?.VITE_ELEVENLABS_AGENT_ID;

  const companionOverrides = useMemo(() => {
    if (!prompt) return null;
    return {
      agent: {
        prompt: { prompt },
        firstMessage: COMPANION_FIRST_MESSAGE,
      },
    };
  }, [prompt]);

  const flushBuffer = async () => {
    const buf = messageBufferRef.current;
    if (buf.length === 0 || !sessionId || !token) return;
    messageBufferRef.current = [];
    try {
      await recordCompanionMessages(
        sessionId,
        token,
        conversationIdRef.current || undefined,
        buf,
      );
    } catch (err) {
      console.warn("[ProctoringCompanion] Flush failed:", err);
      messageBufferRef.current.push(...buf);
    }
  };

  const conversation = useConversation({
    overrides: undefined,
    onConnect: () => {
      setError(null);
      startTimeRef.current = Date.now();
    },
    onDisconnect: () => {
      conversationIdRef.current = null;
    },
    onError: (err) => {
      const msg =
        err && typeof err === "object" && err.message
          ? err.message
          : err
            ? String(err)
            : "Companion connection error";
      console.error("[ProctoringCompanion] onError:", err);
      setError(msg);
    },
    onMessage: (message) => {
      try {
        const normalized = normalizeMessage(message);
        if (!normalized) return;
        setTranscript((prev) => [
          ...prev,
          {
            role: normalized.role,
            text: normalized.text,
            timestamp: new Date(normalized.timestampMs),
          },
        ]);
        messageBufferRef.current.push(normalized);
      } catch (e) {
        console.warn("[ProctoringCompanion] onMessage normalize error:", e);
      }
    },
  });

  useEffect(() => {
    conversationIdRef.current = conversation.conversationId ?? null;
  }, [conversation.conversationId]);

  useEffect(() => {
    if (!sessionId || !token || !agentId) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await getCompanionPrompt(sessionId, token);
        if (cancelled || !result.success) return;
        setPrompt(result.data.prompt);
      } catch (e) {
        if (!cancelled)
          setError(e?.message || "Failed to load companion prompt");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, token, agentId]);

  useEffect(() => {
    if (!prompt || !agentId || startedRef.current) return;
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;
      if (startedRef.current) return;
      if (!companionOverrides) return;
      startedRef.current = true;
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        await conversation.startSession({
          agentId,
          connectionType: "webrtc",
          overrides: companionOverrides,
          dynamicVariables:
            submissionId != null && submissionId !== ""
              ? { submissionId: String(submissionId) }
              : undefined,
        });
      } catch (e) {
        if (!cancelled) {
          startedRef.current = false;
          console.error("[ProctoringCompanion] startSession error:", e);
          setError(
            e?.name === "NotAllowedError"
              ? "Microphone access denied"
              : e?.message || "Failed to start companion",
          );
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [prompt, agentId, companionOverrides, submissionId]);

  useEffect(() => {
    if (!sessionId || !token) return;
    flushIntervalRef.current = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    return () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
    };
  }, [sessionId, token]);

  useEffect(() => {
    if (conversation.status !== "connected" || !startTimeRef.current) return;
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [conversation.status]);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript]);

  useImperativeHandle(
    ref,
    () => ({
      async endAndFlush() {
        await flushBuffer();
        try {
          await conversation.endSession();
        } catch {
          // ignore
        }
      },
    }),
    [sessionId, token, conversation],
  );

  const isConnected = conversation.status === "connected";
  const isSpeaking = Boolean(conversation.isSpeaking);
  const displayMinutes = Math.floor(elapsedSec / 60);
  const displaySeconds = elapsedSec % 60;
  const timeLabel = `${String(displayMinutes).padStart(2, "0")}:${String(displaySeconds).padStart(2, "0")}`;
  const lastLine =
    transcript.length > 0
      ? transcript[transcript.length - 1].text
      : isConnected
        ? "Companion active..."
        : "Connecting...";

  if (!agentId) return null;

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 top-0 z-40 w-full max-w-md",
        className,
      )}
    >
      <motion.div
        layout
        className="bg-gray-900 text-white rounded-b-2xl shadow-xl border border-gray-700 border-t-0 overflow-hidden"
        animate={{
          boxShadow: isSpeaking
            ? "0 4px 20px rgba(34, 197, 94, 0.25), 0 0 0 1px rgba(34, 197, 94, 0.2)"
            : "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
          borderColor: isSpeaking ? "rgba(34, 197, 94, 0.5)" : "rgb(55 65 81)",
        }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm tabular-nums text-gray-300">
              {timeLabel}
            </span>
            {isConnected && (
              <motion.span
                className="relative flex h-2 w-2 flex-shrink-0"
                animate={
                  isSpeaking
                    ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }
                    : { scale: 1, opacity: 1 }
                }
                transition={{
                  repeat: isSpeaking ? Infinity : 0,
                  duration: 1,
                  ease: "easeInOut",
                }}
              >
                {!isSpeaking && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                )}
                {isSpeaking && (
                  <motion.span
                    className="absolute inline-flex h-full w-full rounded-full bg-green-400"
                    animate={{ scale: [1, 2, 2], opacity: [0.6, 0, 0] }}
                    transition={{
                      repeat: Infinity,
                      duration: 1,
                      ease: "easeOut",
                    }}
                  />
                )}
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </motion.span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        <div className="px-4 pb-3">
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          {!expanded ? (
            <p className="text-sm text-gray-200 truncate" title={lastLine}>
              {lastLine}
            </p>
          ) : (
            <div className="h-64 overflow-y-auto space-y-2 pr-1">
              {transcript.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  {isConnected
                    ? "Conversation will appear here..."
                    : "Starting companion..."}
                </p>
              ) : (
                transcript.map((entry, i) => (
                  <div
                    key={i}
                    className={cn(
                      "text-sm rounded-lg px-3 py-2",
                      entry.role === "agent"
                        ? "bg-gray-700 text-gray-100"
                        : "bg-gray-800 text-gray-200 border border-gray-600",
                    )}
                  >
                    <span className="text-xs font-medium text-gray-400 block mb-0.5">
                      {entry.role === "agent" ? "Companion" : "You"}
                    </span>
                    <p className="whitespace-pre-wrap break-words">
                      {entry.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
});

export default ProctoringCompanionNotch;
