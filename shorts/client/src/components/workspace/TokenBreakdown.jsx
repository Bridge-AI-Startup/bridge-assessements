import { useLayoutEffect, useRef, useState } from "react";

/** Keep the panel this far from the viewport edge. */
const EDGE_MARGIN = 8;

/**
 * Hover/tap breakdown of a build's spend: how many tokens went in (the prompt,
 * the chat so far, the current build) versus out (what Claude wrote back).
 *
 * The budget itself is the plain sum of the two — this panel only explains
 * where it went. `input`/`output` are 0 on sessions that started before the
 * split was recorded, which is why the panel says so rather than showing 0s.
 *
 * It anchors under its trigger and then slides itself back into view if that
 * would hang off either edge — the gauge sits near the left edge of a phone
 * header, where a fixed side would clip the panel clean off the screen.
 *
 * @param {{
 *   used: number,
 *   budget: number,
 *   input?: number,
 *   output?: number,
 * }} props
 */
export default function TokenBreakdown({ used, budget, input = 0, output = 0 }) {
  const hasSplit = input > 0 || output > 0;
  const remaining = Math.max(0, budget - used);
  const n = (value) => Number(value || 0).toLocaleString();
  const ref = useRef(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return undefined;

    const clampIntoView = () => {
      const viewport = window.innerWidth;
      // A hidden or not-yet-sized pane reports 0 — any maths off that shoves
      // the panel clean off screen, so leave it anchored and retry on resize.
      if (!viewport || viewport < el.offsetWidth) return;
      // Measure the anchor and the panel's untransformed width: reading the
      // panel's own rect would fold in the shift this effect just applied.
      const anchorLeft = anchor.getBoundingClientRect().left;
      const maxLeft = viewport - EDGE_MARGIN - el.offsetWidth;
      const left = Math.max(EDGE_MARGIN, Math.min(anchorLeft, maxLeft));
      setShift(Math.round(left - anchorLeft));
    };

    clampIntoView();
    window.addEventListener("resize", clampIntoView);
    return () => window.removeEventListener("resize", clampIntoView);
  }, []);

  return (
    <div
      ref={ref}
      role="tooltip"
      style={shift ? { transform: `translateX(${shift}px)` } : undefined}
      className="absolute left-0 top-full z-40 mt-1.5 w-60 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-paper p-3 text-left shadow-card"
    >
      <p className="label-mono text-fog-light">Credits used</p>
      {hasSplit ? (
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fog">Input</dt>
            <dd className="font-mono tabular-nums text-ink">{n(input)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fog">Output</dt>
            <dd className="font-mono tabular-nums text-ink">{n(output)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="font-mono tabular-nums text-ink">
              {n(used)}
              <span className="text-fog-light"> / {n(budget)}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fog">Left</dt>
            <dd className="font-mono tabular-nums text-fog">{n(remaining)}</dd>
          </div>
        </dl>
      ) : (
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="font-mono tabular-nums text-ink">
              {n(used)}
              <span className="text-fog-light"> / {n(budget)}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-fog">Left</dt>
            <dd className="font-mono tabular-nums text-fog">{n(remaining)}</dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-[11px] leading-snug text-fog-light">
        {hasSplit
          ? "Input is what gets sent to Claude — your message plus the build so far. Output is what it writes back."
          : "This build started before the input/output split was tracked."}
      </p>
    </div>
  );
}
