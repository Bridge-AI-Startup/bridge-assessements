import { Play, Quote, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

function formatClock(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return null;
  const s = Math.max(0, Math.floor(Number(sec)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Verdict styling. The three verdicts are deliberately not good/bad/neutral —
 * "unverifiable" is a statement about the record, not the candidate — so the
 * palette keeps it grey rather than warning-coloured.
 */
const VERDICT_STYLES = {
  supported: {
    label: "Supported",
    badge: "bg-green-50 text-green-700 border-green-200",
  },
  contradicted: {
    label: "Not seen in capture",
    badge: "bg-red-50 text-red-700 border-red-200",
  },
  unverifiable: {
    label: "Unverifiable",
    badge: "bg-gray-50 text-gray-500 border-gray-200",
  },
};

function SeekClock({ ts, onSeek }) {
  const clock = formatClock(ts);
  if (!clock) return null;
  if (typeof onSeek !== "function") {
    return (
      <span className="font-mono text-xs tabular-nums text-gray-400 shrink-0">
        {clock}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(Number(ts))}
      title="Watch this moment on the recording"
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-xs tabular-nums text-gray-500 hover:border-gray-300 hover:text-gray-800 shrink-0"
    >
      <Play className="w-2.5 h-2.5 text-gray-400" aria-hidden />
      {clock}
    </button>
  );
}

/**
 * Spoken reasoning (voice companion) assessment on the Summary tab.
 *
 * Renders `evaluationReport.communication`. Three states:
 * - no `communication` field (old reports) or voice never ran → nothing at all;
 * - the candidate spoke too little to judge → one muted factual line, never a
 *   hollow score;
 * - assessed → clarity, summary, quotable highlights, and claim checks
 *   (spoken assertions verified against the captured timeline).
 *
 * Deliberately presentation-only and NOT part of any combined score: narration
 * volume measures comfort talking to a bot, not engineering skill. The header
 * badge says so, so a reviewer never mistakes it for a scored dimension.
 */
export default function CommunicationCard({ communication, onSeek = null }) {
  if (!communication) return null;

  if (!communication.available) {
    // "Barely spoke" is a fact worth one line; a missing/failed pipeline is not.
    if (!String(communication.reason || "").startsWith("too_little_speech")) {
      return null;
    }
    return (
      <div className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-400" aria-hidden />
          <h4 className="text-sm font-semibold text-gray-900">
            Spoken reasoning
          </h4>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          The candidate said very little to the voice check-in (
          {communication.utteranceCount ?? 0} remark
          {(communication.utteranceCount ?? 0) === 1 ? "" : "s"}) — not enough
          to assess. Staying quiet while working is normal and doesn&apos;t
          affect their score.
        </p>
      </div>
    );
  }

  const claims = communication.claimChecks || [];
  const highlights = communication.highlights || [];
  const contradicted = claims.filter((c) => c.verdict === "contradicted").length;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <MessageSquare className="w-4 h-4 text-gray-400" aria-hidden />
        <h4 className="text-sm font-semibold text-gray-900">
          Spoken reasoning
        </h4>
        {communication.clarity != null && (
          <span className="text-sm font-medium tabular-nums text-gray-700">
            Clarity {communication.clarity}/10
          </span>
        )}
        <span className="text-xs text-gray-500">
          {communication.utteranceCount} remarks ·{" "}
          {communication.wordCount} words
        </span>
        <span
          className="ml-auto text-[11px] text-gray-400"
          title="What the candidate said aloud while working, judged on clarity of what was said — never on how much they talked. Not included in any score."
        >
          not part of the score
        </span>
      </div>

      <div className="px-4 py-3 space-y-4">
        {communication.summary && (
          <p className="text-sm text-gray-700 leading-relaxed">
            {communication.summary}
          </p>
        )}

        {highlights.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-500 mb-1.5">
              Worth hearing
            </p>
            <div className="space-y-2">
              {highlights.map((h, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Quote
                    className="w-3 h-3 mt-1 text-gray-300 shrink-0"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 leading-snug">
                      &ldquo;{h.quote}&rdquo;{" "}
                      <SeekClock ts={h.ts} onSeek={onSeek} />
                    </p>
                    {h.whyItMatters && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {h.whyItMatters}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {claims.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-500 mb-1.5">
              What they said, checked against what they did
              {contradicted > 0 && (
                <span className="ml-1 text-red-600">
                  · {contradicted} didn&apos;t match
                </span>
              )}
            </p>
            <div className="space-y-1.5">
              {claims.map((c, i) => {
                const style =
                  VERDICT_STYLES[c.verdict] || VERDICT_STYLES.unverifiable;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2"
                  >
                    <span
                      className={cn(
                        "mt-0.5 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0",
                        style.badge
                      )}
                    >
                      {style.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 leading-snug">
                        {c.claim} <SeekClock ts={c.ts} onSeek={onSeek} />
                      </p>
                      {c.note && (
                        <p className="text-xs text-gray-500 mt-0.5">{c.note}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
