import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Maximize2, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import BoundingBoxOverlay from "./BoundingBoxOverlay";

/** Single highlight: a point (startSec only) or a range (startSec + endSec) with label and optional category/description */
export const HIGHLIGHT_CATEGORY_COLORS = {
  "Uses AI effectively": { bg: "bg-amber-500", border: "border-amber-500", dot: "bg-amber-400" },
  "Reads requirements": { bg: "bg-blue-500", border: "border-blue-500", dot: "bg-blue-400" },
  "Tests and debugs": { bg: "bg-emerald-500", border: "border-emerald-500", dot: "bg-emerald-400" },
  "Code structure": { bg: "bg-violet-500", border: "border-violet-500", dot: "bg-violet-400" },
  integrity: { bg: "bg-rose-500", border: "border-rose-500", dot: "bg-rose-400" },
  default: { bg: "bg-gray-500", border: "border-gray-500", dot: "bg-gray-400" },
};

/**
 * Palette assigned per distinct category present on the timeline.
 *
 * The map above only matches four hardcoded demo labels. Real criteria are
 * whole sentences ("Reads requirements and identifies MongoDB, Express, …"),
 * so every highlight fell through to `default` and the entire timeline came out
 * the same grey — nothing told a reviewer which band belonged to which
 * criterion. Colour is therefore assigned by position in the distinct-category
 * list: stable within a session, and never all-grey.
 *
 * Note these are Tailwind literals on purpose. This project's config remaps the
 * cool ramps (blue/indigo/violet/cyan/teal) onto one warm neutral, so those
 * would land back at indistinguishable grey; the hues below survive the remap.
 */
const HIGHLIGHT_PALETTE = [
  { bg: "bg-amber-500", border: "border-amber-500", dot: "bg-amber-400" },
  { bg: "bg-emerald-500", border: "border-emerald-500", dot: "bg-emerald-400" },
  { bg: "bg-rose-500", border: "border-rose-500", dot: "bg-rose-400" },
  { bg: "bg-orange-500", border: "border-orange-500", dot: "bg-orange-400" },
  { bg: "bg-lime-500", border: "border-lime-500", dot: "bg-lime-400" },
  { bg: "bg-pink-500", border: "border-pink-500", dot: "bg-pink-400" },
  { bg: "bg-yellow-500", border: "border-yellow-500", dot: "bg-yellow-400" },
  { bg: "bg-green-500", border: "border-green-500", dot: "bg-green-400" },
];

/** Short label for a criterion sentence — legends and chips need a few words, not a paragraph. */
export function shortCategoryLabel(category, maxWords = 5) {
  if (!category) return "Moment";
  const words = String(category).trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/** True once the element can accept currentTime (HAVE_METADATA). */
function videoHasMetadata(video) {
  return Boolean(video && video.readyState >= 1);
}

/**
 * Video (or placeholder) with a timeline bar below it. Timeline shows highlights
 * that map to criteria or events; clicking a highlight seeks and shows detail.
 * Duration and current time come only from the HTML5 video element (loadedmetadata / timeupdate).
 *
 * @param {Array<{ startSec: number, endSec?: number, label: string, category?: string, description?: string, score?: number }>} highlights
 * @param {string} [videoUrl] - Optional video src; if missing, placeholder is shown
 * @param {string} [placeholderImageUrl] - Optional image to show when videoUrl is null
 * @param {number} [placeholderDurationSec] - Duration when no video (placeholder mode); default 1
 * @param {number} [durationHintSec] - Fallback duration from API when video element does not report valid duration (e.g. re-mux failed)
 * @param {Array<{ regionType: string, x: number, y: number, width: number, height: number, confidence?: number }>} [regions]
 * @param {number} [seekToSec] - External seek request; applied after HAVE_METADATA, never before
 * @param {number} [seekNonce] - Bump to re-trigger a seek to the same second
 * @param {function} [onPlaybackError] - Signed URL expired or media failed; parent may refresh
 * @param {string} [className]
 */
export default function VideoTimelineWithCriteria({
  highlights = [],
  videoUrl = null,
  placeholderImageUrl = null,
  placeholderDurationSec = 1,
  durationHintSec,
  regions = null,
  seekToSec = null,
  seekNonce = null,
  onPlaybackError,
  className,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const [videoDurationSec, setVideoDurationSec] = useState(null);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);

  // Distinct categories in first-appearance order → stable colour per criterion.
  const categoryOrder = [
    ...new Set(highlights.map((h) => h.category).filter(Boolean)),
  ];
  const colorsFor = (category) => {
    if (!category) return HIGHLIGHT_CATEGORY_COLORS.default;
    if (HIGHLIGHT_CATEGORY_COLORS[category]) {
      return HIGHLIGHT_CATEGORY_COLORS[category];
    }
    const idx = categoryOrder.indexOf(category);
    if (idx < 0) return HIGHLIGHT_CATEGORY_COLORS.default;
    return HIGHLIGHT_PALETTE[idx % HIGHLIGHT_PALETTE.length];
  };

  // Reset duration when video source changes
  useEffect(() => {
    if (!videoUrl) setVideoDurationSec(null);
  }, [videoUrl]);

  const hasVideoDuration =
    videoUrl && videoDurationSec != null && Number.isFinite(videoDurationSec) && videoDurationSec > 0;
  const hasHint = durationHintSec != null && Number.isFinite(durationHintSec) && durationHintSec > 0;
  const effectiveDuration = hasVideoDuration
    ? videoDurationSec
    : (videoUrl && hasHint ? durationHintSec : placeholderDurationSec);

  // Placeholder mode only: animate playhead with interval (no real video)
  useEffect(() => {
    if (!videoUrl && isPlaying) {
      const interval = setInterval(() => {
        setCurrentSec((s) => {
          if (s >= effectiveDuration) {
            setIsPlaying(false);
            return effectiveDuration;
          }
          return s + 0.5;
        });
      }, 500);
      return () => clearInterval(interval);
    }
  }, [videoUrl, isPlaying, effectiveDuration]);

  // External seek (a reviewer clicking a rubric chip or activity-timeline row).
  // Held in a ref because the request usually arrives before the video has
  // metadata. Setting currentTime before HAVE_METADATA is silently dropped
  // and can leave the element blank (the Summary → evidence-chip race).
  const pendingSeekRef = useRef(null);
  const playAfterSeekRef = useRef(false);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  const flushPendingSeek = (video = videoRef.current) => {
    const pending = pendingSeekRef.current;
    if (pending == null || !Number.isFinite(pending) || !videoHasMetadata(video)) {
      return false;
    }
    const d = video.duration;
    const target =
      Number.isFinite(d) && d > 0
        ? Math.max(0, Math.min(pending, d))
        : Math.max(0, pending);
    pendingSeekRef.current = null;
    const wantPlay = playAfterSeekRef.current;
    playAfterSeekRef.current = false;
    video.currentTime = target;
    setCurrentSec(target);
    if (wantPlay) {
      const play = () => {
        setIsPlaying(true);
        video.play().catch(() => {});
      };
      video.addEventListener("seeked", play, { once: true });
      // seeked does not fire if we were already at this time.
      if (Math.abs(video.currentTime - target) < 0.05) play();
    }
    return true;
  };

  // Keep the element in sync with playhead state — but never before metadata,
  // or a chip-click that set currentSec early will blank the player.
  useEffect(() => {
    const video = videoRef.current;
    if (!videoHasMetadata(video) || !videoUrl) return;
    if (pendingSeekRef.current != null) {
      flushPendingSeek(video);
      return;
    }
    if (Math.abs(video.currentTime - currentSec) > 0.25) {
      video.currentTime = currentSec;
    }
  }, [currentSec, videoUrl]);

  // Drive play/pause on the video element when we have real video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else if (videoHasMetadata(video)) {
      video.pause();
    }
  }, [isPlaying, videoUrl]);

  const seekTo = (sec) => {
    const max = effectiveDuration;
    const clamped = Math.max(0, Math.min(sec, max));
    setCurrentSec(clamped);
    const video = videoRef.current;
    if (videoHasMetadata(video)) {
      video.currentTime = clamped;
    } else {
      pendingSeekRef.current = clamped;
    }
  };

  const selectHighlightAt = (sec) => {
    const list = highlightsRef.current || [];
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const start = Number(list[i].startSec);
      if (!Number.isFinite(start)) continue;
      const endRaw = Number(list[i].endSec);
      const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start;
      if (sec >= start - 0.5 && sec <= end + 0.5) {
        const dist = Math.abs(sec - start);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    }
    if (best >= 0) setSelectedHighlight(best);
  };

  useEffect(() => {
    if (seekToSec == null || !Number.isFinite(seekToSec)) return;
    pendingSeekRef.current = seekToSec;
    playAfterSeekRef.current = true;
    selectHighlightAt(seekToSec);
    setCurrentSec(Math.max(0, seekToSec));
    const video = videoRef.current;
    if (!videoUrl || !videoHasMetadata(video)) return;
    flushPendingSeek(video);
    // `seekNonce` changes on every click so re-clicking the same moment still
    // seeks (an identical `seekToSec` alone would not re-run this).
  }, [seekToSec, seekNonce, videoUrl]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-gray-50 overflow-hidden", className)}>
      {/* Video or placeholder */}
      <div className="relative aspect-video bg-gray-900">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            preload={seekToSec != null ? "auto" : "metadata"}
            className="w-full h-full object-contain"
            onLoadedMetadata={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
              flushPendingSeek(e.target);
            }}
            onLoadedData={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
              flushPendingSeek(e.target);
            }}
            onDurationChange={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
              flushPendingSeek(e.target);
            }}
            onCanPlay={(e) => {
              flushPendingSeek(e.target);
            }}
            onTimeUpdate={(e) => setCurrentSec(e.target.currentTime)}
            onEnded={() => setIsPlaying(false)}
            onError={() => {
              if (typeof onPlaybackError === "function") onPlaybackError();
            }}
          />
        ) : placeholderImageUrl ? (
          <img
            src={placeholderImageUrl}
            alt=""
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 bg-gray-900/50" aria-hidden />
        )}
        {/* Transparent bounding box overlay (e.g. region detection demo) */}
        {regions && regions.length > 0 && (
          <BoundingBoxOverlay regions={regions} className="z-[5]" />
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-t border-gray-200">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <span className="text-xs font-mono text-gray-500 tabular-nums">
          {formatTime(currentSec)} / {formatTime(effectiveDuration)}
        </span>
        <div className="flex-1" />
        {videoUrl ? (
          <button
            type="button"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              const request =
                el.requestFullscreen ||
                el.webkitRequestFullscreen ||
                el.webkitEnterFullscreen; // iOS Safari only exposes this one
              if (request) void request.call(el);
            }}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Timeline with highlights */}
      <div className="px-3 pb-3">
        <div
          ref={timelineRef}
          className="relative h-14 rounded-lg bg-gray-800 cursor-pointer group"
          onClick={(e) => {
            const rect = timelineRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = e.clientX - rect.left;
            const pct = x / rect.width;
            seekTo(pct * effectiveDuration);
          }}
        >
          {/* Highlight segments and points */}
          {highlights.map((h, i) => {
            const startPct = effectiveDuration > 0 ? (h.startSec / effectiveDuration) * 100 : 0;
            const endSec = h.endSec ?? h.startSec;
            const endPct = effectiveDuration > 0 ? (endSec / effectiveDuration) * 100 : 0;
            const isRange = (h.endSec != null && h.endSec > h.startSec);
            const colors = colorsFor(h.category);
            const isSelected = selectedHighlight === i;

            return (
              <motion.button
                key={i}
                type="button"
                initial={false}
                animate={{
                  scale: isSelected ? 1.05 : 1,
                  zIndex: isSelected ? 20 : 10,
                }}
                className={cn(
                  "absolute top-1 bottom-1 rounded overflow-hidden border-2 transition-all hover:ring-2 hover:ring-white/50",
                  colors.border,
                  isRange ? "min-w-[4px]" : "w-2 -ml-1 rounded-full"
                )}
                style={{
                  left: `${startPct}%`,
                  width: isRange ? `${Math.max(2, endPct - startPct)}%` : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  seekTo(h.startSec);
                  setSelectedHighlight(selectedHighlight === i ? null : i);
                }}
                title={h.category ? `${h.category} — ${h.label}` : h.label}
              >
                <span className={cn("block h-full min-w-full", colors.bg, isRange ? "opacity-80" : "opacity-100")} />
              </motion.button>
            );
          })}

          {/* Playhead on timeline */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
            style={{ left: `${effectiveDuration > 0 ? (currentSec / effectiveDuration) * 100 : 0}%` }}
          />
        </div>

        {/* Legend: one entry per criterion actually on the timeline */}
        {categoryOrder.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500">
            {categoryOrder.map((cat) => {
              const c = colorsFor(cat);
              const count = highlights.filter((h) => h.category === cat).length;
              return (
                <span
                  key={cat}
                  className="flex items-center gap-1"
                  title={cat}
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", c.dot)} />
                  {shortCategoryLabel(cat)}
                  <span className="text-gray-400">({count})</span>
                </span>
              );
            })}
          </div>
        )}
        {highlights.length > 0 && (
          <p className="mt-1.5 text-[10px] text-gray-400">
            Click a coloured band to jump the video to that moment.
          </p>
        )}
      </div>

      {/* Selected highlight detail panel */}
      {selectedHighlight != null && highlights[selectedHighlight] && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-3 mb-3 p-3 rounded-lg border bg-white border-gray-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-1">
            <Tag className="w-3.5 h-3.5 text-gray-400" />
            <span
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                colorsFor(highlights[selectedHighlight].category).dot
              )}
            />
            <span className="text-xs font-medium text-gray-500">
              {highlights[selectedHighlight].category ?? "Moment"}
            </span>
            {highlights[selectedHighlight].score != null && (
              <span className="text-xs text-gray-600">
                Score: <strong>{highlights[selectedHighlight].score}/10</strong>
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900">{highlights[selectedHighlight].label}</p>
          {highlights[selectedHighlight].description && (
            <p className="text-xs text-gray-600 mt-1">{highlights[selectedHighlight].description}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1 font-mono">
            {formatTime(highlights[selectedHighlight].startSec)}
            {highlights[selectedHighlight].endSec != null && highlights[selectedHighlight].endSec > highlights[selectedHighlight].startSec && (
              <> – {formatTime(highlights[selectedHighlight].endSec)}</>
            )}
          </p>
        </motion.div>
      )}
    </div>
  );
}
