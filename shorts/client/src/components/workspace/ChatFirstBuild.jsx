import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTodayChallenge } from "@/api/challenge";
import Markdown from "@/components/Markdown";
import BuildWaitCard from "@/components/workspace/BuildWaitCard";
import ModelEffortPicker from "@/components/workspace/ModelEffortPicker";
import TokenGauge from "@/components/workspace/TokenGauge";
import DraftRoulette from "@/components/workspace/DraftRoulette";

function previewUrlWithTick(url, tick) {
  return `${url}${url.includes("?") ? "&" : "?"}_=${tick}`;
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </svg>
  );
}

function ScaledPreview({ src, onOpen, logicalWidth = 390 }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);
  const logicalHeight = Math.round(logicalWidth * (12 / 9));

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;
    const update = () =>
      setScale(element.getBoundingClientRect().width / logicalWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [logicalWidth]);

  return (
    <div
      ref={frameRef}
      className="relative aspect-[9/12] w-full overflow-hidden"
    >
      <iframe
        title="Latest build preview"
        src={src}
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{
          width: logicalWidth,
          height: logicalHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
      <button
        type="button"
        aria-label="Open interactive preview"
        onClick={onOpen}
        className="absolute inset-0"
      />
    </div>
  );
}

function PreviewCard({
  message,
  version,
  isLatest,
  previewUrl,
  onOpen,
  compact,
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between border-b border-line bg-cream px-3 py-1.5 text-left"
      >
        <span className="label-mono text-fog-light">Preview · v{version}</span>
        <span className="label-mono text-fog">
          {compact ? "View" : "Open"}
        </span>
      </button>
      {compact ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center justify-center bg-cream px-4 py-6 text-center"
        >
          <span className="label-mono text-fog-light">
            {isLatest
              ? "App updated — live on the right"
              : "Earlier version — open latest preview"}
          </span>
        </button>
      ) : isLatest ? (
        <ScaledPreview
          src={previewUrlWithTick(previewUrl, message.tick)}
          onOpen={onOpen}
        />
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="flex aspect-[9/12] w-full items-center justify-center bg-cream px-8 text-center"
        >
          <span className="label-mono text-fog-light">
            Earlier version — tap to reopen latest
          </span>
        </button>
      )}
    </section>
  );
}

/**
 * Height of the *visible* viewport on mobile, so the Build shell never extends
 * under the on-screen keyboard.
 *
 * `100dvh` is the keyboard-blind height: iOS overlays the keyboard and shifts
 * the visual viewport, so a `100dvh` shell keeps its full height and the browser
 * scrolls the layout to reveal the focused input — taking the header, and the
 * credits meter on it, off the top of the screen. Sizing to
 * `visualViewport.height` and pinning the window back to 0 keeps the header
 * where the builder can see it. Returns null when the API is missing, and the
 * caller falls back to `100dvh`.
 */
function useVisualViewportHeight(enabled) {
  const [height, setHeight] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const apply = () => {
      setHeight(vv.height);
      // The browser may have scrolled the layout viewport to reveal the input.
      // The shell is exactly viewport-sized and scrolls internally, so any page
      // scroll here is the keyboard's doing — undo it.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [enabled]);

  return height;
}

/**
 * Chat-first Build surface (mobile stream, or desktop chat + live preview).
 * @param {{ variant?: "mobile" | "desktop", headerActions?: import("react").ReactNode, leaveControl?: import("react").ReactNode, restartControl?: import("react").ReactNode, cancelModal?: import("react").ReactNode, restartModal?: import("react").ReactNode }} props
 */
export default function ChatFirstBuild({
  variant = "mobile",
  headerActions = null,
  session,
  cadence,
  chatMessages,
  chatInput,
  setChatInput,
  chatBusy,
  chatError,
  onSendMessage,
  onSpinDraft,
  onSpinStart,
  spinningDraft = false,
  showDraftHero = false,
  exhausted,
  tokensUsed,
  tokenBudget,
  inputTokens = 0,
  outputTokens = 0,
  tokenTone,
  previewTick,
  onRefreshPreview,
  modelEffort,
  setModelEffort,
  serverless = false,
  onSubmitClick,
  leaveControl = null,
  restartControl = null,
  chatEndRef,
  submitModal,
  creditsModal,
  creditsKickoff,
  cancelModal = null,
  restartModal = null,
  onShowCreditsHelp,
}) {
  const isDesktop = variant === "desktop";
  const [challengePrompt, setChallengePrompt] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const textareaRef = useRef(null);
  const mobileViewportHeight = useVisualViewportHeight(!isDesktop);
  const challengeLabel =
    cadence === "daily" ? "Today's challenge" : "This week's challenge";

  useEffect(() => {
    let cancelled = false;
    fetchTodayChallenge().then((result) => {
      if (!cancelled && result.status === "ok") {
        setChallengePrompt(result.challenge.prompt || "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const previewPositions = useMemo(() => {
    const positions = new Map();
    let version = 0;
    chatMessages.forEach((message, index) => {
      if (message.role === "preview") {
        version += 1;
        positions.set(index, version);
      }
    });
    return { positions, count: version };
  }, [chatMessages]);

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }

  function submitPrompt(event) {
    event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt) return;
    void onSendMessage(prompt);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function openPreview() {
    if (isDesktop) {
      onRefreshPreview?.();
      return;
    }
    setPreviewOpen(true);
  }

  const latestPreviewSrc = previewUrlWithTick(session.previewUrl, previewTick);

  const chatColumn = (
    <div
      className={`flex min-h-0 min-w-0 flex-col bg-paper ${
        isDesktop
          ? "w-[min(100%,28rem)] flex-shrink-0 border-r border-line xl:w-[32rem]"
          : "flex-1"
      }`}
    >
      <main
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 ${
          isDesktop ? "px-5" : ""
        }`}
      >
        <section className="mr-6 rounded-2xl rounded-bl-md bg-mist px-3.5 py-3">
          <p className="label-mono text-fog-light">{challengeLabel}</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {session.challenge.title}
          </p>
          {challengePrompt ? (
            <Markdown text={challengePrompt} className="mt-1.5 !text-sm" />
          ) : null}
        </section>

        {!isDesktop && showDraftHero ? (
          <DraftRoulette
            variant="hero"
            chatHint="below"
            busy={chatBusy}
            disabled={exhausted || chatBusy}
            onSpin={onSpinDraft}
            onSpinStart={onSpinStart}
          />
        ) : null}

        {chatMessages.map((message, index) => {
          if (message.role === "preview") {
            const version = previewPositions.positions.get(index);
            return (
              <PreviewCard
                key={`preview-${index}-${message.tick}`}
                message={message}
                version={version}
                isLatest={version === previewPositions.count}
                previewUrl={session.previewUrl}
                onOpen={openPreview}
                compact={isDesktop}
              />
            );
          }

          const isUser = message.role === "user";
          const isError =
            !isUser &&
            (message.error === true ||
              /^\(Error:/.test(String(message.text || "")));
          return (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                  isUser
                    ? "rounded-br-md bg-ink text-white"
                    : isError
                      ? "rounded-bl-md border border-red-200 bg-red-50 text-red-700"
                      : "rounded-bl-md bg-mist text-ink"
                }`}
              >
                {message.text}
              </div>
            </div>
          );
        })}

        <BuildWaitCard active={chatBusy} />
        <div ref={chatEndRef} />
      </main>

      <form
        onSubmit={submitPrompt}
        className="flex-shrink-0 border-t border-line bg-paper px-3 pt-2"
        style={
          isDesktop
            ? { paddingBottom: "0.75rem" }
            : {
                paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
              }
        }
      >
        {chatError ? (
          <p role="alert" className="px-1 pb-1 text-xs text-red-600">
            {chatError}
          </p>
        ) : null}
        <div className="mb-1.5">
          <ModelEffortPicker
            value={modelEffort}
            onChange={setModelEffort}
            serverless={serverless}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onInput={resizeTextarea}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitPrompt(event);
              }
            }}
            rows={1}
            enterKeyHint="send"
            placeholder={
              exhausted ? "Out of credits" : "Describe what to build…"
            }
            disabled={chatBusy || exhausted || spinningDraft}
            className="min-h-10 max-h-24 flex-1 resize-none overflow-y-auto rounded-2xl border border-line bg-cream px-4 py-2.5 text-sm text-ink placeholder:text-fog-light focus:border-ink focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label={chatBusy ? "Claude is building" : "Send message"}
            disabled={chatBusy || exhausted || spinningDraft || !chatInput.trim()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      <div
        className="flex flex-col overflow-hidden bg-paper"
        style={{
          height: isDesktop
            ? "100vh"
            : mobileViewportHeight != null
              ? `${mobileViewportHeight}px`
              : "100dvh",
        }}
      >
        {/* Sticky as well as flex-pinned: if anything ever scrolls this column,
            the credits meter still has to stay in view while building. */}
        <header className="sticky top-0 z-20 flex-shrink-0 border-b border-line bg-paper px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium tracking-tight text-ink">
                {session.challenge.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <TokenGauge
                  used={tokensUsed}
                  budget={tokenBudget}
                  inputTokens={inputTokens}
                  outputTokens={outputTokens}
                  tone={tokenTone}
                  exhausted={exhausted}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <button type="button" onClick={onSubmitClick} className="btn-pill">
                Submit
              </button>
              {restartControl}
              {leaveControl}
            </div>
          </div>
        </header>

        {exhausted ? (
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-accent-amber/30 bg-accent-amber/10 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-label text-accent-amber">
            You ran out of credits — no more changes can be made.
            {onShowCreditsHelp ? (
              <button
                type="button"
                onClick={onShowCreditsHelp}
                className="underline underline-offset-2"
              >
                What now?
              </button>
            ) : null}
          </div>
        ) : null}

        {isDesktop ? (
          <div className="flex min-h-0 flex-1">
            {chatColumn}
            <aside className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-cream">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-line bg-paper px-3 py-1.5">
                <span className="label-mono text-fog-light">Preview</span>
                <button
                  type="button"
                  onClick={onRefreshPreview}
                  aria-label="Refresh preview"
                  title="Refresh"
                  className="rounded-md border border-line bg-paper p-1.5 text-fog hover:bg-mist"
                >
                  <RefreshIcon />
                </button>
              </div>
              <div className="relative min-h-0 flex-1">
                <iframe
                  key={previewTick}
                  title="Live build preview"
                  src={latestPreviewSrc}
                  className="absolute inset-0 h-full w-full border-0 bg-paper"
                />
                {showDraftHero ? (
                  <div className="absolute inset-0 z-10 overflow-auto bg-cream px-6 py-10">
                    <div className="mx-auto flex min-h-full max-w-xl items-center">
                      <DraftRoulette
                        variant="hero"
                        chatHint="left"
                        busy={chatBusy}
                        disabled={exhausted || chatBusy}
                        onSpin={onSpinDraft}
                        onSpinStart={onSpinStart}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        ) : (
          chatColumn
        )}
      </div>

      {!isDesktop && previewOpen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-paper"
          style={{ height: "100dvh" }}
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
            <span className="label-mono">Preview</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefreshPreview}
                aria-label="Refresh preview"
                className="rounded-full border border-line bg-paper p-2 text-fog active:bg-mist"
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="btn-pill-secondary"
              >
                Done
              </button>
            </div>
          </div>
          <iframe
            key={previewTick}
            title="Interactive build preview"
            src={latestPreviewSrc}
            className="min-h-0 w-full flex-1 border-0"
          />
        </div>
      ) : null}
      {submitModal}
      {creditsModal}
      {creditsKickoff}
      {cancelModal}
      {restartModal}
    </>
  );
}
