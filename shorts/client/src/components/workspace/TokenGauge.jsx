import { useEffect, useRef, useState } from "react";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function compactTokens(n) {
  const value = Number(n || 0);
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}

const TONES = {
  ok: {
    ring: "stroke-ink",
    track: "stroke-line",
    text: "text-ink",
    shell: "border-line bg-mist/60",
  },
  warn: {
    ring: "stroke-accent-amber",
    track: "stroke-accent-amber/25",
    text: "text-accent-amber",
    shell: "border-accent-amber/40 bg-accent-amber/10",
  },
  danger: {
    ring: "stroke-red-600",
    track: "stroke-red-200",
    text: "text-red-600",
    shell: "border-red-300 bg-red-50",
  },
};

/**
 * Tracks how many tokens were just spent, so callers can flash a "+N" badge.
 * Returns 0 once the flash window has elapsed.
 *
 * @param {number} used
 * @returns {number}
 */
export function useTokenDelta(used) {
  const [delta, setDelta] = useState(0);
  const prevUsedRef = useRef(used);

  useEffect(() => {
    const prev = prevUsedRef.current;
    prevUsedRef.current = used;
    if (!(used > prev)) return undefined;
    setDelta(used - prev);
    const timer = setTimeout(() => setDelta(0), 2200);
    return () => clearTimeout(timer);
  }, [used]);

  return delta;
}

/**
 * Token budget gauge: a ring that fills as the budget is spent, with a
 * short "+N" flash each time Claude burns tokens so usage is hard to miss.
 *
 * @param {{
 *   used: number,
 *   budget: number,
 *   tone?: "ok" | "warn" | "danger",
 *   exhausted?: boolean,
 *   className?: string,
 * }} props
 */
export default function TokenGauge({
  used,
  budget,
  tone = "ok",
  exhausted = false,
  className = "",
}) {
  const delta = useTokenDelta(used);
  const pct = budget > 0 ? clampPct((used / budget) * 100) : 0;
  const palette = TONES[tone] ?? TONES.ok;
  const remaining = Math.max(0, budget - used);

  return (
    <div
      className={`relative inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 ${palette.shell} ${className}`}
      title={`${used.toLocaleString()} of ${budget.toLocaleString()} tokens used (${Math.round(pct)}%) — ${remaining.toLocaleString()} left`}
    >
      <svg
        viewBox="0 0 22 22"
        className={`h-[22px] w-[22px] -rotate-90 ${
          exhausted || tone === "danger" ? "token-gauge-pulse" : ""
        }`}
        role="progressbar"
        aria-label="Token budget used"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <circle
          cx="11"
          cy="11"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          className={palette.track}
        />
        <circle
          cx="11"
          cy="11"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className={`${palette.ring} transition-[stroke-dashoffset] duration-500 ease-out`}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - pct / 100)}
        />
      </svg>
      <span
        className={`font-mono text-[11px] font-medium tabular-nums ${palette.text}`}
      >
        {compactTokens(used)}
        <span className="text-fog-light">/{compactTokens(budget)}</span>
      </span>
      {delta > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-0 ml-1"
        >
          <span
            className={`token-gauge-delta block whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums ${palette.text}`}
          >
            +{compactTokens(delta)}
          </span>
        </span>
      ) : null}
      <span className="sr-only">
        {used.toLocaleString()} of {budget.toLocaleString()} tokens used
      </span>
    </div>
  );
}
