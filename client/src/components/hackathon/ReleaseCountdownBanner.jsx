import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { CHALLENGE_BRAND_NAME } from "@/config/competition";

function parseTargetMs(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function formatRemaining(totalMs) {
  if (totalMs <= 0) return null;
  const s = Math.floor(totalMs / 1000);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (days > 0) {
    return `${days}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
  }
  return `${h}:${pad(m)}:${pad(sec)}`;
}

/**
 * Full-width strip: counts down to `releaseAtIso`. After zero, shows a short live message.
 */
export default function ReleaseCountdownBanner({ releaseAtIso }) {
  const targetMs = parseTargetMs(releaseAtIso);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (targetMs == null) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
        Invalid release time — set <code className="rounded bg-white/80 px-1">HACKATHON_RELEASE_AT</code> in
        config or env.
      </div>
    );
  }

  const remaining = Math.max(0, targetMs - now);
  const live = remaining === 0;

  return (
    <div
      className={
        live
          ? "border-b border-emerald-200 bg-emerald-50/90 px-4 py-3 text-center"
          : "border-b border-[#1e3a8a]/20 bg-gradient-to-r from-[#1e3a8a]/[0.07] via-slate-100 to-[#1e3a8a]/[0.07] px-4 py-3 text-center"
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-1 sm:flex-row sm:gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <Clock className="h-4 w-4 shrink-0 text-[#1e3a8a]" />
          {live ? (
            <span>
              {CHALLENGE_BRAND_NAME} is live — registration is open.
            </span>
          ) : (
            <span>{CHALLENGE_BRAND_NAME} opens in</span>
          )}
        </span>
        {!live ? (
          <span
            className="font-mono text-lg font-semibold tabular-nums tracking-tight text-[#1e3a8a] sm:text-xl"
            suppressHydrationWarning
          >
            {formatRemaining(remaining)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
