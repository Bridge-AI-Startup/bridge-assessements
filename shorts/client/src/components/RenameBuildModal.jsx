import { useEffect, useState } from "react";
import { DISPLAY_NAME_MAX } from "@/lib/displayName";

/**
 * Rename a finished build. Same ownership path as delete; name rules match submit.
 *
 * @param {{
 *   displayName: string,
 *   renaming?: boolean,
 *   error?: string | null,
 *   onConfirm: (nextName: string) => void,
 *   onClose: () => void,
 * }} props
 */
export default function RenameBuildModal({
  displayName,
  renaming = false,
  error = null,
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(displayName);
  const trimmed = value.trim();
  const valid =
    trimmed.length >= 1 &&
    trimmed.length <= DISPLAY_NAME_MAX &&
    trimmed !== displayName.trim();

  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !renaming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, renaming]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-build-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-paper p-6 shadow-card">
        <h2
          id="rename-build-title"
          className="text-lg font-medium tracking-tight text-ink"
        >
          Rename this build
        </h2>
        <p className="mt-1 text-sm text-fog-light">
          New name for &ldquo;{displayName}&rdquo; — up to {DISPLAY_NAME_MAX}{" "}
          characters.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          disabled={renaming}
          autoFocus
          aria-label="New build name"
          className="mt-3 w-full rounded-xl border border-line bg-cream px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !renaming) {
              e.preventDefault();
              onConfirm(trimmed);
            }
          }}
        />
        {error ? (
          <p
            role="status"
            className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={renaming}
            className="btn-pill-secondary whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={renaming || !valid}
            className="btn-pill whitespace-nowrap"
          >
            {renaming ? "Saving…" : "Save name"}
          </button>
        </div>
      </div>
    </div>
  );
}
