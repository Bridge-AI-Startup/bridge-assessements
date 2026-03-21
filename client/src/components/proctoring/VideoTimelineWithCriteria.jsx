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
 * @param {string} [className]
 */
export default function VideoTimelineWithCriteria({
  highlights = [],
  videoUrl = null,
  placeholderImageUrl = null,
  placeholderDurationSec = 1,
  durationHintSec,
  regions = null,
  className,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const [videoDurationSec, setVideoDurationSec] = useState(null);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);

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

  // When user seeks, sync video currentTime (only for real video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
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
    } else {
      video.pause();
    }
  }, [isPlaying, videoUrl]);

  const seekTo = (sec) => {
    const max = effectiveDuration;
    const clamped = Math.max(0, Math.min(sec, max));
    setCurrentSec(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

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
            preload="metadata"
            className="w-full h-full object-contain"
            onLoadedMetadata={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
            }}
            onDurationChange={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
            }}
            onTimeUpdate={(e) => setCurrentSec(e.target.currentTime)}
            onEnded={() => setIsPlaying(false)}
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
        <button
          type="button"
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Fullscreen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
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
            const colors = HIGHLIGHT_CATEGORY_COLORS[h.category] ?? HIGHLIGHT_CATEGORY_COLORS.default;
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
                title={h.label}
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

        {/* Legend: categories */}
        <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-500">
          {[...new Set(highlights.map((h) => h.category).filter(Boolean))].map((cat) => {
            const c = HIGHLIGHT_CATEGORY_COLORS[cat] ?? HIGHLIGHT_CATEGORY_COLORS.default;
            return (
              <span key={cat} className="flex items-center gap-1">
                <span className={cn("w-2 h-2 rounded-full", c.dot)} />
                {cat}
              </span>
            );
          })}
        </div>
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
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
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
