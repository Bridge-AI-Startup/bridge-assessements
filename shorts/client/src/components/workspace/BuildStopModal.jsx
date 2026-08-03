import { useEffect } from "react";

/**
 * Shared shell for the "your build just hit a wall" pop-ups (out of credits,
 * out of time). Plain-language title + explanation, an optional meta line, an
 * optional amber note, and a row of actions.
 *
 * `actions` are given in DOM order — secondary first, primary last — because
 * the row is `flex-col-reverse` on narrow screens, which puts the last (primary)
 * button on top where a thumb lands.
 *
 * @param {{
 *   labelledById: string,
 *   title: string,
 *   description: import("react").ReactNode,
 *   meta?: import("react").ReactNode,
 *   note?: string | null,
 *   footnote?: import("react").ReactNode,
 *   actions: Array<{
 *     label: string,
 *     onClick: () => void,
 *     variant?: "primary" | "secondary",
 *     disabled?: boolean,
 *   }>,
 *   onClose: () => void,
 * }} props
 */
export default function BuildStopModal({
  labelledById,
  title,
  description,
  meta = null,
  note = null,
  footnote = null,
  actions,
  onClose,
}) {
  // Escape closes — these pop-ups inform, they do not trap you on the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-paper p-6 shadow-card">
        <h2
          id={labelledById}
          className="text-lg font-medium tracking-tight text-ink"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-fog-light">{description}</p>
        {meta ? (
          <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-xs text-fog">
            {meta}
          </p>
        ) : null}
        {note ? (
          <p
            role="status"
            className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
          >
            {note}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`whitespace-nowrap ${
                action.variant === "primary" ? "btn-pill" : "btn-pill-secondary"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
        {footnote ? (
          <p className="mt-3 text-center text-xs text-fog-light">{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}
