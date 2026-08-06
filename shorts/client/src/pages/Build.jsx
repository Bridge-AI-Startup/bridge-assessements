import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ensureSession, getSession, getWorkspaceRevision, clearStoredSessionId, pauseSession, pauseSessionBeacon, resumeSession } from "@/api/session";
import { fetchSessionUsage, sendClaudeMessage } from "@/api/claude";
import { submitSession } from "@/api/submit";
import { useAuth } from "@/lib/useAuth";
import AccountModal from "@/components/AccountModal";
import {
  fetchChallengePeriod,
  periodPossessive,
} from "@/lib/challengePeriod";
import {
  DISPLAY_NAME_MAX,
  getDisplayName,
  setDisplayName as persistDisplayName,
} from "@/lib/displayName";
import useIsMobile from "@/lib/useIsMobile";
import {
  loadBuildLayoutMode,
  saveBuildLayoutMode,
} from "@/lib/buildLayout";
import WorkspaceEditor from "@/components/workspace/WorkspaceEditor";
import ModelEffortPicker from "@/components/workspace/ModelEffortPicker";
import ShareBuild from "@/components/ShareBuild";
import ChatFirstBuild from "@/components/workspace/ChatFirstBuild";
import BuildWaitCard from "@/components/workspace/BuildWaitCard";
import OutOfCreditsModal from "@/components/workspace/OutOfCreditsModal";
import {
  compactTokens,
  useTokenDelta,
} from "@/components/workspace/TokenGauge";
import TokenBreakdown from "@/components/workspace/TokenBreakdown";
import SessionWaitlist from "@/components/SessionWaitlist";

const DEFAULT_LEFT_STACK = ["editor", "chat"];
const DEFAULT_LEFT_SIZES = { editor: 55, chat: 45 };

const OUT_OF_CREDITS_MESSAGE = "You ran out of credits for this build.";
/** The round itself closed — the only deadline a build has. */
const ROUND_OVER_MESSAGE = "This round has closed — no more changes can be made.";
/** Shown only after silent recovery gave up — the prompt is restored to the box. */
const CONNECTION_LOST_MESSAGE =
  "Connection dropped — your message is back in the box, tap send to try again.";

/**
 * How long to keep polling for a turn whose response was lost in transit.
 * The server keeps working after the client drops (a build turn can run
 * ~60-100s), so the window has to comfortably outlast a full turn.
 */
const DROPPED_TURN_WINDOW_MS = 150_000;
const DROPPED_TURN_POLL_MS = 4_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A 429 the server raised on the token budget — not an upstream rate limit,
 * which also comes back as 429 but carries the provider's own message.
 */
function isOutOfCreditsError(result) {
  return (
    result.httpStatus === 429 &&
    /token_budget_exceeded/i.test(String(result.message || ""))
  );
}

/** The server refused the turn because the challenge round has closed. */
function isRoundOverError(result) {
  return /session_expired/i.test(String(result.message || ""));
}

function LayoutModeToggle({ mode, onChange }) {
  const options = [
    { id: "chat", label: "Chat" },
    { id: "studio", label: "Studio" },
  ];
  return (
    <div
      role="group"
      aria-label="Build layout"
      className="inline-flex rounded-full border border-line bg-mist p-0.5"
    >
      {options.map((opt) => {
        const active = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`rounded-full px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-label transition-colors ${
              active
                ? "bg-ink text-white"
                : "text-fog hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function formatTokens(n) {
  return Number(n || 0).toLocaleString();
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function meterTone(pct, { warnAt, dangerAt } = {}) {
  const warn = warnAt ?? 80;
  const danger = dangerAt ?? 95;
  if (pct >= danger) return "danger";
  if (pct >= warn) return "warn";
  return "ok";
}

function ProgressMeter({ label, valueLabel, pct, tone = "ok", delta = 0, pulse = false }) {
  const fill =
    tone === "danger"
      ? "bg-red-600"
      : tone === "warn"
        ? "bg-accent-amber"
        : "bg-ink";
  const track =
    tone === "danger"
      ? "bg-red-100"
      : tone === "warn"
        ? "bg-accent-amber/20"
        : "bg-mist";
  const text =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-accent-amber"
        : "text-fog-light";

  return (
    <div className="relative min-w-[7.5rem] max-w-[11rem] flex-1 sm:flex-none">
      <div
        className={`mb-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px] font-medium uppercase tracking-label ${text}`}
      >
        <span>{label}</span>
        <span className="normal-case tracking-normal tabular-nums">
          {valueLabel}
        </span>
      </div>
      <div
        className={`h-1.5 w-full overflow-hidden rounded-full ${track} ${
          pulse ? "token-gauge-pulse" : ""
        }`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${fill}`}
          style={{ width: `${clampPct(pct)}%` }}
        />
      </div>
      {delta > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-full"
        >
          <span
            className={`token-gauge-delta block whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums ${text}`}
          >
            +{compactTokens(delta)}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Token budget meter with a "+N" flash whenever Claude spends tokens, and the
 * input/output breakdown on hover (same panel the chat-first gauge shows).
 */
function TokenMeter({
  used,
  budget,
  pct,
  tone,
  exhausted,
  inputTokens = 0,
  outputTokens = 0,
}) {
  const delta = useTokenDelta(used);
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      <ProgressMeter
        label="Tokens"
        valueLabel={`${formatTokens(used)} / ${formatTokens(budget)}`}
        pct={pct}
        tone={tone}
        delta={delta}
        pulse={exhausted || tone === "danger"}
      />
      {open ? (
        <TokenBreakdown
          used={used}
          budget={budget}
          input={inputTokens}
          output={outputTokens}
        />
      ) : null}
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/** Minimize pane to title bar only. */
function MinimizeToBarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <line x1="5" y1="19" x2="19" y2="19" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PaneChrome({
  title,
  isFullscreen,
  onToggleFullscreen,
  isMinimized = false,
  onToggleMinimize,
  /** When minimized on the right column, render a thin vertical strip. */
  minimizeOrientation = "horizontal",
  actions,
  children,
  reorderable = false,
  onReorderPointerDown,
}) {
  const chromeBtn =
    "rounded-md border border-line bg-paper p-1 text-fog hover:bg-mist";

  if (isMinimized && minimizeOrientation === "vertical") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center gap-2 border-l border-line bg-cream py-2">
        <button
          type="button"
          onClick={onToggleMinimize}
          aria-label="Restore pane"
          title="Restore"
          className={chromeBtn}
        >
          <ExpandIcon />
        </button>
        <span
          className="font-mono text-[10px] font-medium uppercase tracking-label text-fog-light"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {title}
        </span>
        <div className="hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-paper">
      <div
        className={`flex flex-shrink-0 items-center justify-between gap-2 border-b border-line bg-cream px-2 py-1 ${
          reorderable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        title={reorderable ? "Drag to reorder" : undefined}
        onPointerDown={
          reorderable
            ? (e) => {
                if (e.target.closest("button")) return;
                onReorderPointerDown?.(e);
              }
            : undefined
        }
      >
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-label text-fog-light">
          {title}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {!isMinimized && actions}
          {!isFullscreen && onToggleMinimize && (
            <button
              type="button"
              onClick={onToggleMinimize}
              aria-label={isMinimized ? "Restore pane" : "Minimize pane"}
              title={isMinimized ? "Restore" : "Minimize"}
              className={chromeBtn}
            >
              {isMinimized ? <ExpandIcon /> : <MinimizeToBarIcon />}
            </button>
          )}
          {!isMinimized && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Expand pane"}
              title={isFullscreen ? "Exit fullscreen" : "Expand"}
              className={chromeBtn}
            >
              {isFullscreen ? <ExitFullscreenIcon /> : <ExpandIcon />}
            </button>
          )}
        </div>
      </div>
      {/* Keep children mounted while minimized so editor/chat/iframe stay alive. */}
      <div className={isMinimized ? "hidden" : "min-h-0 flex-1"}>{children}</div>
    </div>
  );
}

export default function Build() {
  const isMobile = useIsMobile();
  const [layoutMode, setLayoutMode] = useState(() => loadBuildLayoutMode());
  const [state, setState] = useState({ kind: "provisioning" });
  const [periodCadence, setPeriodCadence] = useState("weekly");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  /** null, or { lastPrompt, note, checking } while the credits pop-up is up. */
  const [creditsModal, setCreditsModal] = useState(null);
  const [displayName, setDisplayName] = useState(() => getDisplayName());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const { user, signedIn } = useAuth();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [splitPct, setSplitPct] = useState(58);
  const [leftPaneSizes, setLeftPaneSizes] = useState(DEFAULT_LEFT_SIZES);
  const [leftStackOrder, setLeftStackOrder] = useState(DEFAULT_LEFT_STACK);
  const [fullscreen, setFullscreen] = useState(null);
  const [minimized, setMinimized] = useState({
    editor: false,
    chat: false,
    preview: false,
  });
  const [dragging, setDragging] = useState(false);
  /** Index of the separator being dragged (between visible panes i and i+1). */
  const [draggingVerticalIndex, setDraggingVerticalIndex] = useState(null);
  const [reorderingPane, setReorderingPane] = useState(null);
  const visibleLeftPanesRef = useRef([]);
  const [previewTick, setPreviewTick] = useState(0);
  const [editorRefreshKey, setEditorRefreshKey] = useState(0);
  const [usage, setUsage] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [modelEffort, setModelEffort] = useState(null);
  const chatEndRef = useRef(null);
  const splitRef = useRef(null);
  const leftColRef = useRef(null);
  const recoveringRef = useRef(false);
  const chatBusyRef = useRef(false);
  const verticalDragRef = useRef(null);
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;

  const loadSession = async () => {
    recoveringRef.current = false;
    const result = await ensureSession();
    if (result.status === "queued") {
      setState({ kind: "queued", queue: result.queue });
      return;
    }
    if (result.status === "error") {
      setState({ kind: "error", message: result.message });
      return;
    }
    const session = result.session;
    if (session.status === "submitted") {
      setState({
        kind: "submitted",
        displayName: "your build",
        fileCount: null,
      });
      return;
    }
    if (session.status === "failed" || session.status === "expired") {
      clearStoredSessionId();
      setState({
        kind: "error",
        message:
          session.error ||
          (session.status === "expired"
            ? "Session expired — click Try again for a new sandbox"
            : "Session failed"),
      });
      return;
    }
    if (!session.previewUrl) {
      setState({
        kind: "error",
        message: "Preview URL missing. Try again.",
      });
      return;
    }
    setState({ kind: "ready", session });
    const restoredMessages = Array.isArray(session.chatMessages)
      ? session.chatMessages.map((m) => ({
          role: m.role,
          text: m.text,
        }))
      : [];
    setChatMessages(
      restoredMessages.length > 0
        ? [...restoredMessages, { role: "preview", tick: Date.now() }]
        : restoredMessages,
    );
    setUsage({
      tokensUsed: session.tokensUsed ?? 0,
      tokenBudget: session.tokenBudget ?? session.challenge.tokenBudget,
      remaining: Math.max(
        0,
        (session.tokenBudget ?? session.challenge.tokenBudget) -
          (session.tokensUsed ?? 0),
      ),
      exhausted:
        (session.tokensUsed ?? 0) >=
        (session.tokenBudget ?? session.challenge.tokenBudget),
      inputTokens: session.inputTokensUsed ?? 0,
      outputTokens: session.outputTokensUsed ?? 0,
      llmCalls: 0,
    });
  };

  useEffect(() => {
    setState({ kind: "provisioning" });
    void loadSession();
  }, []);

  useEffect(() => {
    fetchChallengePeriod()
      .then((p) => setPeriodCadence(p.cadence))
      .catch(() => {});
  }, []);

  // Poll while waiting for a Build seat.
  useEffect(() => {
    if (state.kind !== "queued") return undefined;
    const id = setInterval(() => {
      void loadSession();
    }, 3000);
    return () => clearInterval(id);
  }, [state.kind]);

  // Pause E2B when leaving Build; resume when returning.
  // Never pause while Claude is mid-run — that kills the E2B stream
  // (`2: [unknown] terminated`) and is the main prod-vs-local failure mode.
  useEffect(() => {
    if (state.kind !== "ready") return undefined;
    // Serverless sessions have no sandbox to pause/resume/keep-alive.
    if (state.session.makeMode === "serverless") return undefined;
    const sessionId = state.session.sessionId;
    let pauseTimer = null;
    let disposed = false;
    const PAUSE_AFTER_MS = 45_000;
    const KEEP_ALIVE_MS = 4 * 60 * 1000;

    const canPauseSandbox = () => !chatBusyRef.current;

    const schedulePause = () => {
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        if (!canPauseSandbox()) return;
        void pauseSession(sessionId);
      }, PAUSE_AFTER_MS);
    };

    const cancelPause = () => {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        schedulePause();
        return;
      }
      cancelPause();
      void (async () => {
        const result = await resumeSession(sessionId);
        if (disposed || result.status !== "ok") return;
        setState((prev) =>
          prev.kind === "ready"
            ? { kind: "ready", session: { ...prev.session, ...result.session } }
            : prev,
        );
        setPreviewTick((t) => t + 1);
        setEditorRefreshKey((k) => k + 1);
      })();
    };

    const onPageHide = () => {
      cancelPause();
      if (!canPauseSandbox()) return;
      pauseSessionBeacon(sessionId);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    const keepAlive = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Avoid reconnect churn while Claude holds the command stream.
      if (chatBusyRef.current) return;
      void resumeSession(sessionId).then((result) => {
        if (disposed || result.status !== "ok") return;
        if (result.session.previewUrl) {
          setState((prev) =>
            prev.kind === "ready"
              ? {
                  kind: "ready",
                  session: { ...prev.session, ...result.session },
                }
              : prev,
          );
        }
      });
    }, KEEP_ALIVE_MS);

    return () => {
      disposed = true;
      cancelPause();
      clearInterval(keepAlive);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      if (canPauseSandbox()) {
        pauseSessionBeacon(sessionId);
      }
    };
  }, [state.kind === "ready" ? state.session.sessionId : null]);

  useEffect(() => {
    if (state.kind !== "ready") return undefined;
    const sessionId = state.session.sessionId;
    const id = setInterval(async () => {
      const result = await getSession(sessionId);
      if (result.status !== "ok") return;
      if (result.session.status === "submitted") {
        setState({
          kind: "submitted",
          displayName: "your build",
          fileCount: null,
        });
        return;
      }
      if (
        result.session.status === "failed" ||
        result.session.status === "expired"
      ) {
        // Never tear the page down while the submit dialog is up: the server
        // still accepts the build through the round-end grace window, and
        // unmounting the dialog over a finished build is the worst thing this
        // page can do.
        if (showSubmitModal) return;
        setState({
          kind: "error",
          message:
            result.session.error ||
            (result.session.status === "expired"
              ? "This round has closed"
              : "Session failed"),
        });
      }
    }, 30000);
    return () => clearInterval(id);
  }, [state, showSubmitModal]);

  useEffect(() => {
    if (state.kind !== "ready") return undefined;
    const sessionId = state.session.sessionId;
    let cancelled = false;
    const poll = async () => {
      const u = await fetchSessionUsage(sessionId);
      if (!cancelled && u) setUsage(u);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatBusy]);

  useEffect(() => {
    if (state.kind !== "ready") return undefined;
    // Serverless has no live sandbox to fingerprint — the preview is refreshed
    // explicitly after each make turn instead of by polling.
    if (state.session.makeMode === "serverless") return undefined;
    const sessionId = state.session.sessionId;
    let lastRevision = null;
    let cancelled = false;

    const poll = async () => {
      const result = await getWorkspaceRevision(sessionId);
      if (cancelled || result.status !== "ok") return;
      if (lastRevision == null) {
        lastRevision = result.revision;
        return;
      }
      if (result.revision !== lastRevision) {
        lastRevision = result.revision;
        setPreviewTick((t) => t + 1);
      }
    };

    poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setFullscreen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (!dragging && draggingVerticalIndex == null && !reorderingPane) {
      return undefined;
    }

    const onMove = (e) => {
      if (reorderingPane) {
        const el = leftColRef.current;
        const panes = visibleLeftPanesRef.current;
        if (!el || panes.length < 2) return;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = el.getBoundingClientRect();
        const relative = (clientY - rect.top) / Math.max(rect.height, 1);
        const targetIndex = Math.min(
          panes.length - 1,
          Math.max(0, Math.floor(relative * panes.length)),
        );
        setLeftStackOrder((prev) => {
          const without = prev.filter((id) => id !== reorderingPane);
          const insertAt = Math.min(targetIndex, without.length);
          const next = [
            ...without.slice(0, insertAt),
            reorderingPane,
            ...without.slice(insertAt),
          ];
          if (
            next.length === prev.length &&
            next.every((id, i) => id === prev[i])
          ) {
            return prev;
          }
          return next;
        });
        return;
      }
      if (draggingVerticalIndex != null) {
        const el = leftColRef.current;
        const panes = visibleLeftPanesRef.current;
        const i = draggingVerticalIndex;
        const drag = verticalDragRef.current;
        if (!el || !panes[i] || !panes[i + 1]) return;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const a = panes[i];
        const b = panes[i + 1];
        setLeftPaneSizes((sizes) => {
          const sizeA = sizes[a] ?? 33;
          const sizeB = sizes[b] ?? 33;
          const pairTotal = sizeA + sizeB;
          let pairTop;
          let pairHeight;
          if (drag?.paneA && drag?.paneB) {
            const top = drag.paneA.getBoundingClientRect().top;
            const bottom = drag.paneB.getBoundingClientRect().bottom;
            pairTop = top;
            pairHeight = Math.max(bottom - top, 1);
          } else {
            const rect = el.getBoundingClientRect();
            const minMap = minimizedRef.current;
            const expanded = panes.filter((id) => !minMap[id]);
            const expandedSum =
              expanded.reduce((sum, id) => sum + (sizes[id] ?? 0), 0) || 1;
            const TITLE_BAR_PX = 29;
            const SEP_PX = 6;
            let y = rect.top;
            for (let pi = 0; pi < i; pi++) {
              const id = panes[pi];
              if (minMap[id]) {
                y += TITLE_BAR_PX;
              } else {
                y += ((sizes[id] ?? 0) / expandedSum) * rect.height;
              }
              // Approximate separator between expanded neighbors only
              const next = panes[pi + 1];
              if (next && !minMap[id] && !minMap[next]) y += SEP_PX;
            }
            pairTop = y;
            pairHeight = ((sizeA + sizeB) / expandedSum) * rect.height;
          }
          const localPct =
            ((clientY - pairTop) / Math.max(pairHeight, 1)) * pairTotal;
          const minShare = Math.min(12, pairTotal / 2);
          const newA = Math.min(
            pairTotal - minShare,
            Math.max(minShare, localPct),
          );
          return { ...sizes, [a]: newA, [b]: pairTotal - newA };
        });
        return;
      }
      const el = splitRef.current;
      if (!el) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      setDragging(false);
      setDraggingVerticalIndex(null);
      setReorderingPane(null);
      verticalDragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging, draggingVerticalIndex, reorderingPane]);

  /**
   * @param {string} promptText
   * @param {{ force?: boolean }} [opts] force skips the local credit check —
   *   only the retry path uses it, after re-reading usage from the server
   *   (the `usage` state in this closure is still the stale exhausted one).
   */
  async function sendPrompt(promptText, opts = {}) {
    if (state.kind !== "ready" || chatBusyRef.current) return;
    const prompt = promptText.trim();
    if (!prompt) return;
    if (!opts.force && usage?.exhausted) {
      setChatError(OUT_OF_CREDITS_MESSAGE);
      openCreditsModal(prompt);
      return;
    }
    setChatError(null);
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: prompt }]);
    chatBusyRef.current = true;
    setChatBusy(true);
    // Serverless turns tell us directly whether the file was rewritten (a build)
    // or the model just answered in chat, so the success path only probes the
    // sandbox revision on E2B. The pre-send revision is still captured in both
    // modes (serverless is a cheap snapshot-timestamp read) because it is the
    // only way the dropped-connection recovery below can tell whether the
    // recovered turn rebuilt the app.
    const serverless = state.session.makeMode === "serverless";
    const revisionBefore = await getWorkspaceRevision(state.session.sessionId);
    const result = await sendClaudeMessage(state.session.sessionId, prompt, {
      model: modelEffort?.model,
      effort: modelEffort?.effort,
    });
    if (result.status === "error") {
      // No httpStatus means the request died at the network layer (phone
      // locked mid-turn, cell blip, tab suspended). The server almost always
      // finishes the turn anyway and persists the chat pair — so before
      // admitting failure, quietly poll the session for that pair and render
      // it as if the response had arrived normally.
      if (result.httpStatus === undefined) {
        const recovered = await recoverDroppedTurn(prompt, revisionBefore);
        if (recovered) {
          chatBusyRef.current = false;
          setChatBusy(false);
          return;
        }
      }
      chatBusyRef.current = false;
      setChatBusy(false);
      const outOfCredits = isOutOfCreditsError(result);
      const roundOver = isRoundOverError(result);
      const networkDrop = result.httpStatus === undefined;
      const message = outOfCredits
        ? OUT_OF_CREDITS_MESSAGE
        : roundOver
          ? ROUND_OVER_MESSAGE
          : networkDrop
            ? CONNECTION_LOST_MESSAGE
            : result.message;
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", error: true, text: `(${message})` },
      ]);
      if (networkDrop) {
        // Put the message back so retrying is one tap, not a re-type.
        setChatInput(prompt);
      }
      if (outOfCredits) {
        // Server refused the turn on budget — reflect it in the meter too.
        setUsage((prev) =>
          prev ? { ...prev, remaining: 0, exhausted: true } : prev,
        );
        openCreditsModal(prompt);
      }
      return;
    }
    const revisionAfter = serverless
      ? null
      : await getWorkspaceRevision(state.session.sessionId);
    const workspaceChanged = serverless
      ? result.result.workspaceChanged !== false
      : revisionBefore.status !== "ok" ||
        revisionAfter.status !== "ok" ||
        revisionBefore.revision !== revisionAfter.revision;
    setChatMessages((prev) => {
      const next = [
        ...prev,
        {
          role: "assistant",
          text: result.result.output || "(No output)",
        },
      ];
      return workspaceChanged
        ? [...next, { role: "preview", tick: Date.now() }]
        : next;
    });
    if (result.result.usage) {
      setUsage(result.result.usage);
      // Last turn drained the budget — tell the builder before they type again.
      if (result.result.usage.exhausted) {
        openCreditsModal();
      }
    }
    if (workspaceChanged) {
      setPreviewTick((t) => t + 1);
      setEditorRefreshKey((k) => k + 1);
    }
    chatBusyRef.current = false;
    setChatBusy(false);
  }

  /**
   * The claude/message POST died at the network layer, but the server keeps
   * processing the turn and appends the user/assistant pair to the session's
   * `chatMessages` when it finishes. Poll the session until that pair shows
   * up, then render it exactly like a normal response (reply bubble, preview
   * refresh, token meter). Returns true when the turn was recovered.
   *
   * The wait card stays up the whole time (chatBusy is still true), so a
   * successful recovery is invisible to the builder.
   */
  async function recoverDroppedTurn(prompt, revisionBefore) {
    const sentAt = Date.now();
    const deadline = sentAt + DROPPED_TURN_WINDOW_MS;
    // The pair is matched by prompt text, so guard against re-sends of an
    // identical prompt: the reply must postdate this send, minus a modest
    // allowance for client/server clock skew.
    const clockSkewMs = 60_000;
    while (Date.now() < deadline) {
      await sleep(DROPPED_TURN_POLL_MS);
      if (state.kind !== "ready") return false;
      const sessionResult = await getSession(state.session.sessionId);
      if (sessionResult.status !== "ok") continue;
      const msgs = sessionResult.session.chatMessages || [];
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1 || msgs[lastUserIdx].text !== prompt) continue;
      const reply = msgs[lastUserIdx + 1];
      if (!reply || reply.role !== "assistant") continue;
      const repliedAt = reply.createdAt ? Date.parse(reply.createdAt) : NaN;
      if (Number.isFinite(repliedAt) && repliedAt < sentAt - clockSkewMs) {
        continue;
      }

      const revisionAfter = await getWorkspaceRevision(state.session.sessionId);
      const workspaceChanged =
        revisionBefore.status !== "ok" ||
        revisionAfter.status !== "ok" ||
        revisionBefore.revision !== revisionAfter.revision;
      setChatMessages((prev) => {
        const next = [
          ...prev,
          { role: "assistant", text: reply.text || "(No output)" },
        ];
        return workspaceChanged
          ? [...next, { role: "preview", tick: Date.now() }]
          : next;
      });
      const freshUsage = await fetchSessionUsage(state.session.sessionId);
      if (freshUsage) {
        setUsage(freshUsage);
        if (freshUsage.exhausted) openCreditsModal();
      }
      if (workspaceChanged) {
        setPreviewTick((t) => t + 1);
        setEditorRefreshKey((k) => k + 1);
      }
      setChatError(null);
      return true;
    }
    return false;
  }

  function openCreditsModal(lastPrompt = null) {
    setCreditsModal({ lastPrompt, note: null, checking: false });
  }

  /**
   * "Try again" from the out-of-credits pop-up: re-read the meter from the
   * server first — the turn may have failed on a passing upstream hiccup — and
   * only re-send the last message if credits actually came back.
   */
  async function retryAfterOutOfCredits() {
    if (state.kind !== "ready") return;
    setCreditsModal((prev) =>
      prev ? { ...prev, checking: true, note: null } : prev,
    );
    const fresh = await fetchSessionUsage(state.session.sessionId);
    if (fresh) setUsage(fresh);
    if (fresh && !fresh.exhausted) {
      const prompt = creditsModal?.lastPrompt;
      setCreditsModal(null);
      setChatError(null);
      if (prompt) void sendPrompt(prompt, { force: true });
      return;
    }
    setCreditsModal((prev) =>
      prev
        ? {
            ...prev,
            checking: false,
            note: "Still out of credits — there is nothing left to spend on this build.",
          }
        : prev,
    );
  }

  function handleChatSubmit(e) {
    e.preventDefault();
    void sendPrompt(chatInput);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (state.kind !== "ready" || submitting) return;
    const name = displayName.trim();
    if (!name) {
      setSubmitError({ message: "Enter a name" });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await submitSession({
      sessionId: state.session.sessionId,
      displayName: name,
    });
    setSubmitting(false);
    if (result.status === "error") {
      setSubmitError(
        result.code === "starter_only"
          ? {
              code: "starter_only",
              message: result.message,
            }
          : /session_expired|session_not_active/i.test(
                String(result.message || ""),
              )
            ? {
                message:
                  "This round closed before the build went through — submissions for it are done.",
              }
            : { message: result.message },
      );
      return;
    }
    persistDisplayName(result.result.displayName || name);
    // No client-side account link here: the submit request carries the ID token
    // when signed in, so the server stamps the submission with the account and
    // claims this browser id in the same transaction.
    setShowSubmitModal(false);
    setState({
      kind: "submitted",
      displayName: result.result.displayName,
      fileCount: result.result.fileCount,
      // Lets the success screen offer a share link straight to the new entry.
      submissionId: result.result.submissionId,
    });
  }

  if (state.kind === "provisioning") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
        <p className="mt-4 text-sm font-medium text-fog">
          Starting your workspace…
        </p>
        <p className="mt-1 text-xs text-fog-light">
          This can take up to a minute the first time.
        </p>
      </div>
    );
  }

  if (state.kind === "queued") {
    const q = state.queue;
    return (
      <SessionWaitlist
        activeCount={q.activeCount}
        maxConcurrent={q.maxConcurrent}
        estimatedWaitSeconds={q.estimatedWaitSeconds}
      />
    );
  }

  if (state.kind === "error" || state.kind === "expired") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-6">
        <p className="text-lg font-medium tracking-tight text-ink">
          {state.kind === "expired"
            ? "Time’s up"
            : "Could not start workspace"}
        </p>
        <p className="mt-2 max-w-md text-center text-sm text-fog">
          {state.message}
        </p>
        <div className="mt-6 flex gap-3">
          {state.kind === "error" ? (
            <button type="button" onClick={loadSession} className="btn-pill">
              Retry
            </button>
          ) : (
            <button type="button" onClick={loadSession} className="btn-pill">
              Start again
            </button>
          )}
          <Link to="/" className="btn-pill-secondary">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (state.kind === "submitted") {
    const possessive = periodPossessive(periodCadence);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-6">
        <p className="text-[22px] font-medium tracking-tight text-ink">
          Submitted
        </p>
        <p className="mt-2 text-sm text-fog">
          Saved as <span className="font-medium text-ink">{state.displayName}</span>
          {state.fileCount != null ? ` (${state.fileCount} files)` : ""}.
        </p>
        <p className="mt-3 max-w-sm text-center text-sm text-fog-light">
          Next: vote on {possessive} builds — five comparisons unlock a ranking
          recap.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/Vote" className="btn-pill">
            Vote on {possessive} builds
          </Link>
          {/* Resumed already-submitted sessions don't carry the id — no share. */}
          {state.submissionId ? (
            <ShareBuild
              submissionId={state.submissionId}
              displayName={state.displayName}
              isMine
            />
          ) : null}
          <Link to="/Gallery" className="btn-pill-secondary">
            Browse rankings
          </Link>
        </div>
        <Link to="/" className="mt-4 text-sm text-fog-light hover:underline">
          Back to Home
        </Link>
      </div>
    );
  }

  const { session } = state;
  // Serverless mode has no sandbox files, so the Studio editor can't mount —
  // force the chat-first layout and hide the layout toggle.
  const serverless = session.makeMode === "serverless";
  const chatFullscreen = fullscreen === "chat";
  const editorFullscreen = fullscreen === "editor";
  const previewFullscreen = fullscreen === "preview";
  const showChat = !fullscreen || chatFullscreen;
  const showEditor = !fullscreen || editorFullscreen;
  const showPreview = !fullscreen || previewFullscreen;
  const showLeftColumn = showEditor || showChat;
  const previewMinimized = minimized.preview && !previewFullscreen;
  const previewSrc = `${session.previewUrl}${
    session.previewUrl.includes("?") ? "&" : "?"
  }_=${previewTick}`;

  function toggleMinimize(paneId) {
    setMinimized((prev) => ({ ...prev, [paneId]: !prev[paneId] }));
    if (fullscreen === paneId) setFullscreen(null);
  }

  function enterFullscreen(paneId) {
    setMinimized((prev) => (prev[paneId] ? { ...prev, [paneId]: false } : prev));
    setFullscreen(paneId);
  }

  const tokenBudget =
    usage?.tokenBudget ??
    session.tokenBudget ??
    session.challenge.tokenBudget ??
    0;
  const tokensUsed = usage?.tokensUsed ?? session.tokensUsed ?? 0;
  const inputTokens = usage?.inputTokens ?? session.inputTokensUsed ?? 0;
  const outputTokens = usage?.outputTokens ?? session.outputTokensUsed ?? 0;
  const exhausted = usage?.exhausted ?? tokensUsed >= tokenBudget;
  const tokenPct =
    tokenBudget > 0 ? clampPct((tokensUsed / tokenBudget) * 100) : 0;
  const tokenTone = exhausted
    ? "danger"
    : meterTone(tokenPct, { warnAt: 80, dangerAt: 95 });

  // Builds have no clock. The only thing that can close a session is the round
  // ending, which the 30s status poll picks up; credits are the sole limit the
  // builder works against.
  const chatLocked = exhausted;

  const leftColumnWidth =
    editorFullscreen || chatFullscreen
      ? "100%"
      : previewMinimized
        ? undefined
        : showPreview
          ? `${splitPct}%`
          : "100%";

  const visibleLeftPanes = leftStackOrder.filter((id) => {
    if (id === "editor") return showEditor;
    if (id === "chat") return showChat;
    return false;
  });
  visibleLeftPanesRef.current = visibleLeftPanes;
  const multiLeftPanesVisible = visibleLeftPanes.length > 1 && !fullscreen;
  const expandedLeftPanes = visibleLeftPanes.filter(
    (id) => !minimized[id] || !!fullscreen,
  );
  const sizeSum = expandedLeftPanes.reduce(
    (sum, id) => sum + (leftPaneSizes[id] ?? 0),
    0,
  );

  const paneTitle = {
    editor: "Editor",
    chat: "Claude Code",
  };

  function renderLeftPane(paneId) {
    if (paneId === "editor") {
      return (
        <PaneChrome
          title="Editor"
          isFullscreen={editorFullscreen}
          onToggleFullscreen={() =>
            editorFullscreen ? setFullscreen(null) : enterFullscreen("editor")
          }
          isMinimized={minimized.editor && !editorFullscreen}
          onToggleMinimize={() => toggleMinimize("editor")}
          reorderable={multiLeftPanesVisible}
          onReorderPointerDown={(e) => {
            e.preventDefault();
            setReorderingPane("editor");
          }}
        >
          <WorkspaceEditor
            sessionId={session.sessionId}
            refreshKey={editorRefreshKey}
            onSaved={() => setPreviewTick((t) => t + 1)}
            onSandboxLost={(msg) => {
              if (recoveringRef.current) return;
              recoveringRef.current = true;
              clearStoredSessionId();
              setState({
                kind: "error",
                message:
                  msg ||
                  "Sandbox no longer reachable. Click Try again to start a new workspace.",
              });
            }}
          />
        </PaneChrome>
      );
    }

    return (
      <PaneChrome
        title="Claude Code"
        isFullscreen={chatFullscreen}
        onToggleFullscreen={() =>
          chatFullscreen ? setFullscreen(null) : enterFullscreen("chat")
        }
        isMinimized={minimized.chat && !chatFullscreen}
        onToggleMinimize={() => toggleMinimize("chat")}
        reorderable={multiLeftPanesVisible}
        onReorderPointerDown={(e) => {
          e.preventDefault();
          setReorderingPane("chat");
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {!chatFullscreen && (
            <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-400">
              Describe what to build — Claude Code edits files in the sandbox.
            </p>
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {chatMessages.filter((m) => m.role !== "preview").map((m, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-4 bg-slate-900 text-white"
                    : "mr-2 bg-slate-100 text-slate-800"
                }`}
              >
                {m.text}
              </div>
            ))}
            <BuildWaitCard active={chatBusy} />
            <div ref={chatEndRef} />
          </div>
          {chatError && (
            <p className="px-3 text-xs text-red-600">{chatError}</p>
          )}
          <form
            onSubmit={handleChatSubmit}
            className="border-t border-slate-100 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <ModelEffortPicker
                value={modelEffort}
                onChange={setModelEffort}
                serverless={serverless}
              />
            </div>
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              rows={chatFullscreen ? 5 : 2}
              placeholder={
                exhausted ? "Out of credits" : "Ask Claude Code to build…"
              }
              disabled={chatBusy || chatLocked}
              className="w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
            <button
              type="submit"
              disabled={chatBusy || exhausted || !chatInput.trim()}
              className="mt-2 w-full rounded bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {chatBusy ? "Working…" : "Send"}
            </button>
          </form>
        </div>
      </PaneChrome>
    );
  }

  function openSubmitModal() {
    setSubmitError(null);
    setDisplayName((prev) => prev.trim() || getDisplayName());
    setShowSubmitModal(true);
  }

  function closeSubmitModal() {
    setShowSubmitModal(false);
  }

  function setBuildLayout(mode) {
    setLayoutMode(mode);
    saveBuildLayoutMode(mode);
  }

  const submitModal = showSubmitModal ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-paper p-6 shadow-card"
      >
        <h2 className="text-lg font-medium tracking-tight text-ink">
          Submit your build
        </h2>
        <p className="mt-1 text-sm text-fog-light">
          Confirm the name for this submission. Your workspace will be saved
          and closed.
        </p>
        {signedIn ? (
          <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-xs text-fog">
            Signed in as{" "}
            <span className="font-medium text-ink">{user?.email}</span> — this
            build will be saved to your account.
          </p>
        ) : (
          <div className="mt-2 rounded-xl bg-mist px-3 py-2 text-xs text-fog">
            Submitting as a guest keeps this build in this browser only.{" "}
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              disabled={submitting}
              className="font-medium text-ink underline"
            >
              Create an account or sign in
            </button>{" "}
            to keep it across devices.
          </div>
        )}
        <label className="mt-4 block text-sm font-medium text-fog">
          Name
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={DISPLAY_NAME_MAX}
            autoFocus
            className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-fog-light focus:border-ink focus:outline-none"
            placeholder="Your name"
            disabled={submitting}
          />
        </label>
        {submitError && (
          <div
            role="alert"
            className={
              submitError.code === "starter_only"
                ? "mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
                : "mt-2 text-sm text-red-600"
            }
          >
            {submitError.code === "starter_only" ? (
              <>
                <p className="font-medium">Nothing to submit yet</p>
                <p className="mt-0.5 text-amber-900/90">
                  {submitError.message}
                </p>
              </>
            ) : (
              <p>{submitError.message}</p>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeSubmitModal}
            disabled={submitting}
            className="btn-pill-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !displayName.trim()}
            className="btn-pill"
          >
            {submitting
              ? "Submitting…"
              : signedIn
                ? "Confirm submit"
                : "Submit as guest"}
          </button>
        </div>
      </form>
      {showAccountModal && (
        <AccountModal
          title="Save this build to an account"
          subtitle="Sign in or create an account, then confirm your submission — it will follow you across devices."
          onClose={() => setShowAccountModal(false)}
        />
      )}
    </div>
  ) : null;

  const creditsModalNode = creditsModal ? (
    <OutOfCreditsModal
      tokensUsed={tokensUsed}
      tokenBudget={tokenBudget}
      note={creditsModal.note}
      checking={creditsModal.checking}
      onSubmitBuild={() => {
        setCreditsModal(null);
        openSubmitModal();
      }}
      onTryAgain={() => void retryAfterOutOfCredits()}
      onClose={() => setCreditsModal(null)}
    />
  ) : null;

  const layoutToggle = (
    <LayoutModeToggle mode={layoutMode} onChange={setBuildLayout} />
  );

  const chatFirstProps = {
    session,
    cadence: periodCadence,
    chatMessages,
    chatInput,
    setChatInput,
    chatBusy,
    chatError,
    onSendMessage: sendPrompt,
    exhausted,
    tokensUsed,
    tokenBudget,
    inputTokens,
    outputTokens,
    tokenTone,
    previewTick,
    onRefreshPreview: () => setPreviewTick((tick) => tick + 1),
    modelEffort,
    setModelEffort,
    serverless,
    onSubmitClick: openSubmitModal,
    chatEndRef,
    submitModal,
    creditsModal: creditsModalNode,
    onShowCreditsHelp: () => openCreditsModal(),
  };

  if (isMobile) {
    return <ChatFirstBuild variant="mobile" {...chatFirstProps} />;
  }

  if (serverless || layoutMode === "chat") {
    return (
      <ChatFirstBuild
        variant="desktop"
        headerActions={serverless ? undefined : layoutToggle}
        {...chatFirstProps}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-cream">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="label-mono">Today&apos;s challenge</p>
          <p className="truncate text-sm font-medium tracking-tight text-ink">
            {session.challenge.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {tokenBudget > 0 ? (
              <TokenMeter
                used={tokensUsed}
                budget={tokenBudget}
                pct={tokenPct}
                tone={tokenTone}
                exhausted={exhausted}
                inputTokens={inputTokens}
                outputTokens={outputTokens}
              />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {layoutToggle}
          <button
            type="button"
            onClick={openSubmitModal}
            className="btn-pill"
          >
            Submit
          </button>
          <Link to="/" className="btn-pill-secondary">
            Home
          </Link>
        </div>
      </header>

      {exhausted && (
        <div className="flex items-center justify-center gap-2 border-b border-accent-amber/30 bg-accent-amber/8 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-label text-accent-amber">
          You ran out of credits — no more changes can be made.
          <button
            type="button"
            onClick={() => openCreditsModal()}
            className="underline underline-offset-2"
          >
            What now?
          </button>
        </div>
      )}

      <div
        ref={splitRef}
        className={`relative flex min-h-0 flex-1 ${
          dragging || draggingVerticalIndex != null || reorderingPane
            ? "select-none"
            : ""
        }`}
      >
        {showLeftColumn && (
          <div
            ref={leftColRef}
            className={`relative flex min-h-0 min-w-0 flex-col ${
              previewMinimized ? "flex-1" : ""
            }`}
            style={{
              width: leftColumnWidth,
              flexShrink: previewMinimized ? 1 : 0,
            }}
          >
            {visibleLeftPanes.map((paneId, index) => {
              const paneMinimized = minimized[paneId] && !fullscreen;
              const alone =
                expandedLeftPanes.length <= 1 || !!fullscreen;
              const weight =
                alone || sizeSum <= 0
                  ? 1
                  : (leftPaneSizes[paneId] ?? 1) / sizeSum;
              const flexStyle = paneMinimized
                ? { flex: "0 0 auto" }
                : { flex: `${weight} 1 0%` };
              const prevId = visibleLeftPanes[index - 1];
              const prevMinimized = prevId ? minimized[prevId] && !fullscreen : false;
              const showVSeparator =
                index > 0 &&
                multiLeftPanesVisible &&
                !paneMinimized &&
                !prevMinimized;

              return (
                <Fragment key={paneId}>
                  {showVSeparator && (
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label={`Resize ${paneTitle[visibleLeftPanes[index - 1]]} and ${paneTitle[paneId]}`}
                      tabIndex={0}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const sep = e.currentTarget;
                        verticalDragRef.current = {
                          paneA: sep.previousElementSibling,
                          paneB: sep.nextElementSibling,
                        };
                        setDraggingVerticalIndex(index - 1);
                      }}
                      onKeyDown={(e) => {
                        const a = visibleLeftPanes[index - 1];
                        const b = paneId;
                        if (e.key === "ArrowUp") {
                          setLeftPaneSizes((sizes) => {
                            const pair = (sizes[a] ?? 33) + (sizes[b] ?? 33);
                            const nextA = Math.min(
                              pair - 12,
                              (sizes[a] ?? 33) + 2,
                            );
                            return { ...sizes, [a]: nextA, [b]: pair - nextA };
                          });
                        } else if (e.key === "ArrowDown") {
                          setLeftPaneSizes((sizes) => {
                            const pair = (sizes[a] ?? 33) + (sizes[b] ?? 33);
                            const nextA = Math.max(12, (sizes[a] ?? 33) - 2);
                            return { ...sizes, [a]: nextA, [b]: pair - nextA };
                          });
                        }
                      }}
                      className="group relative z-10 h-1.5 flex-shrink-0 cursor-row-resize bg-slate-200 hover:bg-slate-400 active:bg-slate-500"
                    >
                      <div className="absolute inset-x-0 -top-1 -bottom-1" />
                    </div>
                  )}

                  <div
                    className={`min-w-0 ${
                      paneMinimized ? "flex-shrink-0" : "min-h-0"
                    } ${paneId === "chat" ? "flex flex-col bg-white" : ""}`}
                    style={flexStyle}
                  >
                    {renderLeftPane(paneId)}
                  </div>
                </Fragment>
              );
            })}

            {(draggingVerticalIndex != null || reorderingPane) && (
              <div
                className={`absolute inset-0 z-20 ${
                  reorderingPane ? "cursor-grabbing" : "cursor-row-resize"
                }`}
              />
            )}
          </div>
        )}

        {showLeftColumn && showPreview && !fullscreen && !previewMinimized && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize preview panel"
            aria-valuenow={Math.round(splitPct)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                setSplitPct((p) => Math.max(20, p - 2));
              } else if (e.key === "ArrowRight") {
                setSplitPct((p) => Math.min(80, p + 2));
              }
            }}
            className="group relative z-10 w-1.5 flex-shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-400 active:bg-slate-500"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {showPreview && (
          <div
            className="min-h-0 min-w-0"
            style={
              previewMinimized
                ? { width: 40, flexShrink: 0 }
                : { flex: "1 1 0%", minWidth: 0 }
            }
          >
            <PaneChrome
              title="Preview"
              isFullscreen={previewFullscreen}
              onToggleFullscreen={() =>
                previewFullscreen
                  ? setFullscreen(null)
                  : enterFullscreen("preview")
              }
              isMinimized={previewMinimized}
              onToggleMinimize={() => toggleMinimize("preview")}
              minimizeOrientation="vertical"
              actions={
                <button
                  type="button"
                  onClick={() => setPreviewTick((t) => t + 1)}
                  aria-label="Refresh preview"
                  title="Refresh preview"
                  className="rounded-md border border-line bg-paper p-1 text-fog hover:bg-mist"
                >
                  <RefreshIcon />
                </button>
              }
            >
              <iframe
                title="Preview"
                key={previewTick}
                src={previewSrc}
                className="h-full w-full border-0"
              />
            </PaneChrome>
          </div>
        )}

        {dragging && (
          <div className="absolute inset-0 z-20 cursor-col-resize" />
        )}
      </div>

      {submitModal}
      {creditsModalNode}
    </div>
  );
}
