import { useEffect, useState } from "react";
import { setStarred } from "@/api/stars";

function StarIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/**
 * Save/unsave a build (a private bookmark — no public counts anywhere, by
 * design). Optimistic: the star flips immediately and reverts on error.
 *
 * Variants: `icon` is the small round overlay for gallery card previews
 * (stops propagation so it doesn't follow the card's link); `pill` is the
 * labelled button for the Submission page action row.
 */
export default function StarButton({
  submissionId,
  starred = false,
  onChange,
  variant = "icon",
  className = "",
}) {
  const [isStarred, setIsStarred] = useState(starred);
  const [busy, setBusy] = useState(false);

  // Membership often loads after first paint — trust the latest prop.
  useEffect(() => setIsStarred(starred), [starred]);

  async function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !isStarred;
    setIsStarred(next);
    setBusy(true);
    try {
      await setStarred(submissionId, next);
      onChange?.(submissionId, next);
    } catch {
      setIsStarred(!next);
    } finally {
      setBusy(false);
    }
  }

  const label = isStarred ? "Remove from saved" : "Save this build";

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={isStarred}
        title={label}
        className={`btn-pill-secondary gap-1.5 ${
          isStarred ? "text-accent-amber" : ""
        } ${className}`}
      >
        <StarIcon filled={isStarred} />
        {isStarred ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isStarred}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-line shadow-card transition-colors ${
        isStarred
          ? "bg-accent-amber/15 text-accent-amber"
          : "bg-paper/90 text-fog hover:text-ink"
      } ${className}`}
    >
      <StarIcon filled={isStarred} />
    </button>
  );
}
