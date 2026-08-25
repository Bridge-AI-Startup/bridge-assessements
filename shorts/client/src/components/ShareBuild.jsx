import { useEffect, useRef, useState } from "react";

/** Tailwind w-56, used to decide which edge the popover hangs from. */
const POPOVER_WIDTH_PX = 224;
const COPIED_RESET_MS = 2000;

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
    </svg>
  );
}

function legacyCopy(value) {
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * Share a build: native OS share sheet on touch devices (Messages / WhatsApp /
 * AirDrop beat anything we could draw), a small popover with Copy link + share
 * intents everywhere else. The shared URL is the ordinary public submission
 * page; social crawlers hitting it get OG tags via the Vercel bot-UA rewrite
 * to `GET /api/shorts/share`.
 */
export default function ShareBuild({
  submissionId,
  displayName,
  isMine = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(true);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);
  const copyTimerRef = useRef(null);

  const url = `${window.location.origin}/Submission?id=${encodeURIComponent(
    submissionId,
  )}`;
  const text = isMine
    ? `My build “${displayName}” for this round's Bridge Shorts challenge`
    : `“${displayName}” on Bridge Shorts`;

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  // Same dismissal rules as the header dropdowns: outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleTriggerClick() {
    const nativeShare =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      window.matchMedia?.("(pointer: coarse)")?.matches;
    if (nativeShare) {
      try {
        await navigator.share({ title: "Bridge Shorts", text, url });
      } catch {
        // User dismissed the sheet — nothing to do.
      }
      return;
    }
    // Hang the popover from whichever edge keeps it on screen — this button
    // sits at the right of a title row on one page and centered on another.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setAlignRight(rect.left + POPOVER_WIDTH_PX > window.innerWidth - 16);
    }
    setCopied(false);
    setOpen((v) => !v);
  }

  async function handleCopy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = legacyCopy(url);
    }
    // "failed" reveals the URL in a selectable field — privacy-hardened
    // browsers deny programmatic clipboard writes, and silence would read
    // as the button doing nothing.
    setCopied(ok ? "ok" : "failed");
    clearTimeout(copyTimerRef.current);
    if (ok) {
      copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    }
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm text-ink hover:bg-mist";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-pill-secondary gap-1.5"
      >
        <ShareIcon />
        Share
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-2 w-56 rounded-xl border border-line bg-paper py-1 shadow-card ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <p className="label-mono px-3 pb-1 pt-2">
            {isMine ? "Share your build" : "Share this build"}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            className={`${itemClass} font-medium`}
          >
            {copied === "ok" ? "Copied ✓" : "Copy link"}
          </button>
          {copied === "failed" && (
            <div className="px-3 pb-2">
              <p className="pb-1 text-[11px] text-fog-light">
                Couldn’t access the clipboard — copy it here:
              </p>
              <input
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="w-full rounded border border-line bg-mist px-2 py-1 font-mono text-[11px] text-ink"
              />
            </div>
          )}
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(
              text,
            )}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            Share on X
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            Share on WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
