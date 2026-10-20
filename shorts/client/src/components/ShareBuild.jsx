import { useEffect, useRef, useState } from "react";
import { renderStoryCard, storyCardFilename } from "@/lib/storyCard";

/** Tailwind w-60, used to decide which edge the popover hangs from. */
const POPOVER_WIDTH_PX = 240;
const COPIED_RESET_MS = 2000;
const STORY_NOTE_RESET_MS = 6000;

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

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return legacyCopy(value);
  }
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Share a build. One popover everywhere: Copy link, an Instagram story card,
 * and share intents (X / WhatsApp). Touch devices get the native OS sheet as
 * the first item — Messages / WhatsApp / AirDrop beat anything we could draw —
 * but no longer *only* the sheet, because Instagram has no URL share target:
 * a story needs an image, so the Instagram item renders a 1080×1920 card
 * (`lib/storyCard.js`) and hands it to the share sheet where files are
 * supported, or downloads it. Either way the build link is copied for the
 * link sticker, since the card itself cannot be a link.
 *
 * The shared URL is the ordinary public submission page; social crawlers
 * hitting it get OG tags via the Vercel bot-UA rewrite to
 * `GET /api/shorts/share`.
 */
export default function ShareBuild({
  submissionId,
  displayName,
  challengeTitle = null,
  rank = null,
  isMine = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(true);
  const [copied, setCopied] = useState(false);
  // idle | busy | shared | saved | nocopy | failed
  const [story, setStory] = useState("idle");
  const rootRef = useRef(null);
  const copyTimerRef = useRef(null);
  const storyTimerRef = useRef(null);

  const url = `${window.location.origin}/Submission?id=${encodeURIComponent(
    submissionId,
  )}`;
  const text = isMine
    ? `My build “${displayName}” for this round's Bridge Shorts challenge`
    : `“${displayName}” on Bridge Shorts`;
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const touch =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)")?.matches;

  useEffect(
    () => () => {
      clearTimeout(copyTimerRef.current);
      clearTimeout(storyTimerRef.current);
    },
    [],
  );

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

  function handleTriggerClick() {
    // Hang the popover from whichever edge keeps it on screen — this button
    // sits at the right of a title row on one page and centered on another.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setAlignRight(rect.left + POPOVER_WIDTH_PX > window.innerWidth - 16);
    }
    setCopied(false);
    setStory("idle");
    setOpen((v) => !v);
  }

  async function handleNativeShare() {
    try {
      await navigator.share({ title: "Bridge Shorts", text, url });
      setOpen(false);
    } catch {
      // User dismissed the sheet — leave the popover up.
    }
  }

  async function handleCopy() {
    const ok = await copyText(url);
    // "failed" reveals the URL in a selectable field — privacy-hardened
    // browsers deny programmatic clipboard writes, and silence would read
    // as the button doing nothing.
    setCopied(ok ? "ok" : "failed");
    clearTimeout(copyTimerRef.current);
    if (ok) {
      copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    }
  }

  async function handleInstagram() {
    if (story === "busy") return;
    setStory("busy");
    clearTimeout(storyTimerRef.current);
    // Clipboard first, while the click's user activation is still fresh.
    const linkCopied = await copyText(url);
    try {
      const blob = await renderStoryCard({
        displayName,
        challengeTitle,
        rank,
        host: window.location.host,
      });
      const filename = storyCardFilename(displayName);
      const file = new File([blob], filename, { type: "image/png" });
      let outcome = "saved";
      if (canNativeShare && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Bridge Shorts" });
          outcome = "shared";
        } catch (err) {
          if (err?.name === "AbortError") {
            setStory("idle");
            return;
          }
          saveBlob(blob, filename);
        }
      } else {
        saveBlob(blob, filename);
      }
      setStory(linkCopied ? outcome : "nocopy");
    } catch {
      setStory("failed");
    }
    storyTimerRef.current = setTimeout(
      () => setStory("idle"),
      STORY_NOTE_RESET_MS,
    );
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm text-ink hover:bg-mist";

  const storyNote =
    story === "shared"
      ? "Link copied — add it as a link sticker."
      : story === "saved"
        ? "Story card saved. Link copied — add it as a link sticker."
        : story === "nocopy"
          ? "Story card ready. Copy the link above for the sticker."
          : story === "failed"
            ? "Couldn’t make the story card."
            : null;

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
          className={`absolute top-full z-40 mt-2 w-60 rounded-xl border border-line bg-paper py-1 shadow-card ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <p className="label-mono px-3 pb-1 pt-2">
            {isMine ? "Share your build" : "Share this build"}
          </p>
          {canNativeShare && touch ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleNativeShare}
              className={`${itemClass} font-medium`}
            >
              Share…
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            className={`${itemClass} ${canNativeShare && touch ? "" : "font-medium"}`}
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
          <button
            type="button"
            role="menuitem"
            onClick={handleInstagram}
            disabled={story === "busy"}
            className={`${itemClass} disabled:opacity-60`}
          >
            {story === "busy" ? "Making the story card…" : "Instagram story"}
          </button>
          {storyNote ? (
            <p
              className={`px-3 pb-2 text-[11px] ${
                story === "failed" ? "text-red-600" : "text-fog-light"
              }`}
            >
              {storyNote}
            </p>
          ) : null}
          {!(canNativeShare && touch) ? (
            <>
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
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
