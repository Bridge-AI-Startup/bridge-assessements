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
 *
 * @param {number} durationSeconds - Total timeline length in seconds
 * @param {Array<{ startSec: number, endSec?: number, label: string, category?: string, description?: string, score?: number }>} highlights
 * @param {string} [videoUrl] - Optional video src; if missing, placeholder is shown
 * @param {string} [placeholderImageUrl] - Optional image to show when videoUrl is null (e.g. /placeholder-video.png)
 * @param {Array<{ regionType: string, x: number, y: number, width: number, height: number, confidence?: number }>} [regions] - Optional region bounding boxes (percent) to overlay as transparent boxes
 * @param {string} [className]
 */
export default function VideoTimelineWithCriteria({
  durationSeconds = 600,
  highlights = [],
  videoUrl = null,
  placeholderImageUrl = null,
  regions = null,
  className,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);

  // Simple playhead advance (no real video = just animate time)
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentSec((s) => {
        if (s >= durationSeconds) {
          setIsPlaying(false);
          return durationSeconds;
        }
        return s + 0.5;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, durationSeconds]);

  // Sync video if we have one
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.currentTime = currentSec;
  }, [currentSec, videoUrl]);

  const seekTo = (sec) => {
    setCurrentSec(Math.max(0, Math.min(sec, durationSeconds)));
    if (videoRef.current) videoRef.current.currentTime = sec;
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
            className="w-full h-full object-contain"
            onTimeUpdate={(e) => setCurrentSec(e.target.currentTime)}
            onEnded={() => setIsPlaying(false)}
          />
        ) : placeholderImageUrl ? (
          <img
            src={placeholderImageUrl}
            alt="Screen recording"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center mb-3">
              <Play className="w-8 h-8 text-gray-500 ml-1" />
            </div>
            <span className="text-sm font-medium">Screen recording</span>
            <span className="text-xs text-gray-600 mt-1">{formatTime(currentSec)} / {formatTime(durationSeconds)}</span>
          </div>
        )}
        {/* Transparent bounding box overlay (e.g. region detection demo) */}
        {regions && regions.length > 0 && (
          <BoundingBoxOverlay regions={regions} className="z-[5]" />
        )}
        {/* Playhead overlay line on video */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
          style={{ left: `${(currentSec / durationSeconds) * 100}%` }}
        />
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
          {formatTime(currentSec)} / {formatTime(durationSeconds)}
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
            seekTo(pct * durationSeconds);
          }}
        >
          {/* Highlight segments and points */}
          {highlights.map((h, i) => {
            const startPct = (h.startSec / durationSeconds) * 100;
            const endSec = h.endSec ?? h.startSec;
            const endPct = (endSec / durationSeconds) * 100;
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
            style={{ left: `${(currentSec / durationSeconds) * 100}%` }}
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
