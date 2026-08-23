import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compactTokens } from "@/components/workspace/TokenGauge";
import { CREDITS_METER_ID } from "@/lib/creditsIntro";

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Hand-drawn coach mark: a sketchy arrow from a sticker card up to the credits
 * gauge in the header. Shown once per account (or per guest browser id).
 *
 * @param {{
 *   tokenBudget: number,
 *   onClose: () => void,
 * }} props
 */
export default function CreditsKickoffModal({ tokenBudget, onClose }) {
  const credits = Math.max(0, Number(tokenBudget) || 0);
  const cardRef = useRef(null);
  const pathRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const [pathLength, setPathLength] = useState(0);

  const measure = useCallback(() => {
    const meter = document.getElementById(CREDITS_METER_ID);
    const card = cardRef.current;
    if (!meter || !card) return;

    const meterRect = meter.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (meterRect.width < 1 || cardRect.width < 1) return;

    const pad = 6;
    const spotlight = {
      top: meterRect.top - pad,
      left: meterRect.left - pad,
      width: meterRect.width + pad * 2,
      height: meterRect.height + pad * 2,
    };

    // Tail starts just above the card, head lands under the meter: the arrow
    // always travels card → meter, so the head belongs at the meter end.
    const arrowFrom = {
      x: cardRect.left + cardRect.width * 0.3,
      y: cardRect.top - 10,
    };
    const arrowTo = {
      x: meterRect.left + meterRect.width * 0.45,
      y: meterRect.bottom + 10,
    };

    // Bow the curve into the empty space to the right — the meter and card both
    // hug the left edge, so bowing left would run off screen.
    const midX = (arrowFrom.x + arrowTo.x) / 2;
    const midY = (arrowFrom.y + arrowTo.y) / 2;
    const ctrl = { x: midX + 54, y: midY + 4 };

    const viewportW = window.innerWidth;
    const cardTop = meterRect.bottom + 64;
    const cardLeft = clamp(
      meterRect.left - 4,
      12,
      Math.max(12, viewportW - cardRect.width - 12),
    );

    setLayout({
      spotlight,
      spotlightRadius: Math.min(spotlight.height / 2, 16),
      ctrl,
      arrowPath: `M ${arrowFrom.x} ${arrowFrom.y} Q ${ctrl.x} ${ctrl.y} ${arrowTo.x} ${arrowTo.y}`,
      cardTop,
      cardLeft,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    const meter = document.getElementById(CREDITS_METER_ID);
    const card = cardRef.current;
    if (observer) {
      if (meter) observer.observe(meter);
      if (card) observer.observe(card);
    }
    const retry = requestAnimationFrame(() => measure());
    return () => {
      cancelAnimationFrame(retry);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      observer?.disconnect();
    };
  }, [measure, credits]);

  // The draw-in animation dashes the stroke, so it needs the real curve length —
  // a hardcoded dasharray leaves a permanent gap on longer arrows.
  useLayoutEffect(() => {
    if (!layout || !pathRef.current) return;
    try {
      setPathLength(Math.ceil(pathRef.current.getTotalLength()));
    } catch {
      setPathLength(0);
    }
  }, [layout]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reducedMotion = prefersReducedMotion();

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-kickoff-title"
      onClick={onClose}
    >
      {layout ? (
        <>
          {/* Transparent hole: the real credits gauge shows through it. Any
              background here paints over the thing being pointed at. */}
          <div
            className="pointer-events-none fixed z-[71] border-[3px] border-accent-amber shadow-[0_0_0_9999px_rgba(33,32,28,0.45)]"
            style={{
              top: layout.spotlight.top,
              left: layout.spotlight.left,
              width: layout.spotlight.width,
              height: layout.spotlight.height,
              borderRadius: layout.spotlightRadius,
            }}
            aria-hidden="true"
          />
          <svg
            className="pointer-events-none fixed inset-0 z-[72] h-full w-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="credits-kickoff-arrowhead"
                markerUnits="userSpaceOnUse"
                markerWidth="18"
                markerHeight="18"
                refX="11"
                refY="6"
                orient="auto"
              >
                {/* Tip on the +x side — orient="auto" rotates the marker so its
                    x-axis follows the path, so a left-facing tip renders backwards. */}
                <path
                  d="M 0 0 L 12 6 L 0 12 L 3 6 Z"
                  fill="#21201C"
                  stroke="#21201C"
                  strokeWidth="0.75"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            <path
              ref={pathRef}
              d={layout.arrowPath}
              fill="none"
              stroke="#21201C"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#credits-kickoff-arrowhead)"
              className={reducedMotion ? undefined : "credits-kickoff-arrow"}
              style={pathLength ? { "--dash": String(pathLength) } : undefined}
            />
            <text
              x={layout.ctrl.x + 10}
              y={layout.ctrl.y}
              transform={`rotate(-6 ${layout.ctrl.x + 10} ${layout.ctrl.y})`}
              className="fill-ink font-mono text-[10px] uppercase"
              style={{ letterSpacing: "0.08em" }}
            >
              credits left
            </text>
          </svg>
        </>
      ) : (
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      )}

      <div
        className="pointer-events-none fixed z-[73] sm:p-0"
        style={
          layout
            ? {
                top: layout.cardTop,
                left: layout.cardLeft,
                right: "auto",
                bottom: "auto",
                padding: 0,
              }
            : {
                opacity: 0,
                pointerEvents: "none",
                top: -9999,
                left: -9999,
              }
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={cardRef}
          className={`pointer-events-auto punch-card w-[17rem] rotate-[-2deg] bg-paper px-5 py-5 ${
            reducedMotion ? "" : "credits-kickoff-card"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="label-mono text-accent-amber">Your budget</p>
          <h2
            id="credits-kickoff-title"
            className="mt-1.5 text-[20px] font-semibold leading-tight tracking-tight text-ink"
          >
            You&rsquo;ve got credits
          </h2>
          <p
            className="mt-3 font-mono text-[36px] font-semibold leading-none tabular-nums text-ink"
            style={{ letterSpacing: "-0.04em" }}
          >
            {credits.toLocaleString()}
          </p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-label text-fog">
            {compactTokens(credits)} for prompts
          </p>
          <p className="mt-3 text-sm leading-relaxed text-fog">
            <span className="font-medium text-ink">Watch the meter up top</span>{" "}
            — that&rsquo;s your pile. Same challenge, same model; spend it on
            something you&rsquo;d rather keep open.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn-pill mt-4 w-full px-6"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
