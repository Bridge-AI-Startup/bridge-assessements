import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Maximize2 } from "lucide-react";
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
 * @param {string} [overlayVariant] - "default" | "demo" for BoundingBoxOverlay (demo = icons, glow, stagger)
 * @param {boolean} [showDetectionScan] - If true, run a one-time "scan line" animation over the video (demo flair)
 * @param {boolean} [interactive] - If false, auto-plays, no clickable controls or timeline; detail panel follows playhead (landing page)
 * @param {string} [className]
 */
export default function VideoTimelineWithCriteria({
  durationSeconds = 600,
  highlights = [],
  videoUrl = null,
  placeholderImageUrl = null,
  regions = null,
  overlayVariant = "default",
  showDetectionScan = false,
  interactive = true,
  className,
}) {
  const [isPlaying, setIsPlaying] = useState(interactive ? false : true);
  const [currentSec, setCurrentSec] = useState(0);
  const [scanComplete, setScanComplete] = useState(false);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);

  // Auto-advance playhead (interactive: only when playing, stop at end; non-interactive: always, loop)
  useEffect(() => {
    const shouldAdvance = interactive ? isPlaying : true;
    if (!shouldAdvance) return;
    const interval = setInterval(() => {
      setCurrentSec((s) => {
        if (s >= durationSeconds) {
          if (!interactive) return 0; // loop on landing
          setIsPlaying(false);
          return durationSeconds;
        }
        return s + 0.5;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [interactive, isPlaying, durationSeconds]);

  const [manualHighlight, setManualHighlight] = useState(null);

  // Non-interactive: derive highlight from current time; interactive: use manual selection
  const derivedHighlightIndex =
    !interactive && highlights.length > 0
      ? (() => {
          const inRange = highlights.findIndex(
            (h) => currentSec >= h.startSec && currentSec <= (h.endSec ?? h.startSec)
          );
          if (inRange >= 0) return inRange;
          let lastPassed = -1;
          for (let i = 0; i < highlights.length; i++) {
            if (highlights[i].startSec <= currentSec) lastPassed = i;
          }
          return lastPassed >= 0 ? lastPassed : 0;
        })()
      : null;
  const effectiveHighlight = interactive ? manualHighlight : derivedHighlightIndex;

  // Sync video if we have one
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.currentTime = currentSec;
  }, [currentSec, videoUrl]);

  const seekTo = interactive
    ? (sec) => {
        setCurrentSec(Math.max(0, Math.min(sec, durationSeconds)));
        if (videoRef.current) videoRef.current.currentTime = sec;
      }
    : () => {};

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "rounded-2xl overflow-hidden shadow-lg",
        "bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl",
        "border border-white/20 dark:border-white/10",
        className
      )}
    >
      {/* Video or placeholder */}
      <div className="relative aspect-video bg-gray-950 rounded-t-2xl overflow-hidden">
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
          <BoundingBoxOverlay
            regions={regions}
            variant={overlayVariant}
            className="z-[5]"
          />
        )}
        {/* One-time "AI detecting" scan line (demo) — badge only; scan line is on timeline */}
        {showDetectionScan && !scanComplete && (
          <motion.div
            className="absolute top-3 left-3 z-[6] px-2.5 py-1 rounded-md text-xs font-medium text-white backdrop-blur-sm border border-white/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ backgroundColor: "rgba(99, 102, 241, 0.85)" }}
          >
            Detecting regions…
          </motion.div>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white/50 backdrop-blur-sm border-b border-white/30">
        {interactive ? (
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
        ) : (
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-900/80 text-white shadow-sm pointer-events-none"
            aria-hidden
          >
            <Play className="w-4 h-4 ml-0.5" />
          </div>
        )}
        <span className="text-sm font-medium text-gray-600 tabular-nums">
          {formatTime(currentSec)}
          <span className="text-gray-400 font-normal mx-1">/</span>
          {formatTime(durationSeconds)}
        </span>
        <div className="flex-1" />
        {interactive && (
          <button
            type="button"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Timeline with highlights */}
      <div className="px-4 py-4 bg-white/30 backdrop-blur-sm">
        <div
          ref={timelineRef}
          className={cn(
            "relative h-12 rounded-xl bg-gray-100 overflow-hidden",
            interactive && "cursor-pointer"
          )}
          onClick={
            interactive
              ? (e) => {
                  const rect = timelineRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const x = e.clientX - rect.left;
                  const pct = x / rect.width;
                  seekTo(pct * durationSeconds);
                }
              : undefined
          }
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
        >
          {/* Inner track (subtle depth) */}
          <div className="absolute inset-1 rounded-lg bg-gray-200/60" />
          {/* Highlight segments and points */}
          {highlights.map((h, i) => {
            const startPct = (h.startSec / durationSeconds) * 100;
            const endSec = h.endSec ?? h.startSec;
            const endPct = (endSec / durationSeconds) * 100;
            const isRange = (h.endSec != null && h.endSec > h.startSec);
            const colors = HIGHLIGHT_CATEGORY_COLORS[h.category] ?? HIGHLIGHT_CATEGORY_COLORS.default;
            const isSelected = effectiveHighlight === i;

            return (
              <motion.div
                key={i}
                initial={false}
                animate={{
                  scale: isSelected ? 1.02 : 1,
                  zIndex: isSelected ? 15 : 5,
                }}
                className={cn(
                  "absolute top-1.5 bottom-1.5 rounded-md overflow-hidden transition-all duration-200",
                  interactive && "hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400 cursor-pointer"
                )}
                style={{
                  left: `${startPct}%`,
                  width: isRange ? `${Math.max(3, endPct - startPct)}%` : undefined,
                }}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        seekTo(h.startSec);
                        setManualHighlight(manualHighlight === i ? null : i);
                      }
                    : undefined
                }
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          seekTo(h.startSec);
                          setManualHighlight(manualHighlight === i ? null : i);
                        }
                      }
                    : undefined
                }
                title={h.label}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
              >
                <span
                  className={cn(
                    "block h-full min-w-full rounded-md",
                    colors.bg,
                    isRange ? "opacity-70" : "opacity-90",
                    interactive && (isRange ? "hover:opacity-85" : "hover:opacity-100")
                  )}
                />
              </motion.div>
            );
          })}

          {/* Scan line (demo): sweeps left-to-right in front of timeline colors, one-time */}
          {showDetectionScan && !scanComplete && (
            <motion.div
              className="absolute top-0 bottom-0 w-6 pointer-events-none z-30 rounded-full"
              initial={{ left: "0%" }}
              animate={{ left: "100%" }}
              transition={{
                duration: 1.8,
                ease: [0.32, 0.72, 0, 1],
                delay: 0.3,
              }}
              onAnimationComplete={() => setScanComplete(true)}
              style={{
                background: "linear-gradient(to right, transparent, rgba(99, 102, 241, 0.4), transparent)",
                boxShadow: "0 0 16px rgba(99, 102, 241, 0.25)",
              }}
            />
          )}

          {/* Playhead — clean white line with shadow */}
          <div
            className="absolute top-0 bottom-0 w-0.5 pointer-events-none z-20 rounded-full bg-white shadow-[0_0_8px_rgba(0,0,0,0.3)]"
            style={{ left: `${(currentSec / durationSeconds) * 100}%` }}
          />
        </div>

        {/* Legend: category pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {[...new Set(highlights.map((h) => h.category).filter(Boolean))].map((cat) => {
            const c = HIGHLIGHT_CATEGORY_COLORS[cat] ?? HIGHLIGHT_CATEGORY_COLORS.default;
            return (
              <span
                key={cat}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-gray-600 bg-gray-100",
                  "border border-gray-200/80"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", c.dot)} />
                {cat}
              </span>
            );
          })}
        </div>
      </div>

      {/* Highlight detail panel (selected in interactive mode, or current segment in auto mode) */}
      {effectiveHighlight != null && highlights[effectiveHighlight] && (
        <motion.div
          key={effectiveHighlight}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mx-4 mb-4 p-4 rounded-xl bg-white/60 backdrop-blur-md border border-white/40"
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className={cn(
                "w-1 h-8 rounded-full shrink-0",
                (HIGHLIGHT_CATEGORY_COLORS[highlights[effectiveHighlight].category] ?? HIGHLIGHT_CATEGORY_COLORS.default).bg
              )}
            />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {highlights[effectiveHighlight].category ?? "Moment"}
            </span>
            {highlights[effectiveHighlight].score != null && (
              <span className="text-xs text-gray-500 ml-auto">
                <span className="font-medium text-gray-700">{highlights[effectiveHighlight].score}</span>
                <span className="text-gray-400">/10</span>
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-900 leading-snug">
            {highlights[effectiveHighlight].label}
          </p>
          {highlights[effectiveHighlight].description && (
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
              {highlights[effectiveHighlight].description}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-2 font-mono tabular-nums">
            {formatTime(highlights[effectiveHighlight].startSec)}
            {highlights[effectiveHighlight].endSec != null && highlights[effectiveHighlight].endSec > highlights[effectiveHighlight].startSec && (
              <> – {formatTime(highlights[effectiveHighlight].endSec)}</>
            )}
          </p>
        </motion.div>
      )}
    </div>
  );
}
