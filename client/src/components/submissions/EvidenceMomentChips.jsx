import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

function formatClock(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return null;
  const s = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function snippet(text, max = 42) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

/**
 * Rubric evidence as compact, always-visible chips.
 *
 * Each chip is a cited moment: a clock time plus a short observation. When
 * `onSeek` is provided (a screen recording exists), a click jumps the review
 * to that offset on the Recording tab — the same path the activity timeline
 * already uses. Without a recording the chips stay informative, not fake
 * buttons.
 */
export default function EvidenceMomentChips({
  evidence = [],
  onSeek = null,
  className,
}) {
  const moments = (evidence || []).filter(
    (ev) => ev && Number.isFinite(Number(ev.ts))
  );
  if (moments.length === 0) return null;

  return (
    <div className={cn("mt-3", className)}>
      <p className="text-[11px] font-medium text-gray-500 mb-1.5">
        {moments.length === 1 ? "Evidence" : `${moments.length} moments`}
        {onSeek ? (
          <span className="font-normal text-gray-400">
            {" "}
            · click to watch
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {moments.map((ev, i) => {
          const start = Number(ev.ts);
          const end = Number(ev.ts_end);
          const startLabel = formatClock(start);
          const endLabel =
            Number.isFinite(end) && end > start + 1 ? formatClock(end) : null;
          const clock = endLabel ? `${startLabel}–${endLabel}` : startLabel;
          const observation = snippet(ev.observation);
          const seekable = typeof onSeek === "function";
          const title = [
            ev.observation || "Cited moment",
            seekable ? "Click to watch this moment on the recording." : null,
          ]
            .filter(Boolean)
            .join(" — ");

          const inner = (
            <>
              {seekable ? (
                <Play className="w-2.5 h-2.5 shrink-0 text-gray-400" aria-hidden />
              ) : null}
              <span className="font-mono tabular-nums text-gray-500 shrink-0">
                {clock}
              </span>
              {observation ? (
                <span className="truncate text-gray-800">{observation}</span>
              ) : null}
            </>
          );

          const chipClass = cn(
            "inline-flex items-center gap-1.5 max-w-[240px] rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] leading-tight",
            seekable &&
              "cursor-pointer hover:border-gray-400 hover:bg-[#FAF9F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
          );

          if (seekable) {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(start)}
                className={chipClass}
                title={title}
                aria-label={`Watch recording at ${clock}${observation ? `: ${ev.observation}` : ""}`}
              >
                {inner}
              </button>
            );
          }

          return (
            <span key={i} className={chipClass} title={title}>
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}
