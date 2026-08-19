import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  Maximize2,
  Tag,
  Loader2,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import BoundingBoxOverlay from "./BoundingBoxOverlay";

/** Single highlight: a point (startSec only) or a range (startSec + endSec) with label and optional category/description */
export const HIGHLIGHT_CATEGORY_COLORS = {
  "Uses AI effectively": { bg: "bg-amber-500", border: "border-amber-500", dot: "bg-amber-400" },
  // blue / violet used to live here; this project's Tailwind remaps the cool
  // ramps onto one warm neutral, so those two lanes came out indistinguishable
  // grey. Every hue below survives the remap.
  "Reads requirements": { bg: "bg-orange-500", border: "border-orange-500", dot: "bg-orange-400" },
  "Tests and debugs": { bg: "bg-emerald-500", border: "border-emerald-500", dot: "bg-emerald-400" },
  "Code structure": { bg: "bg-pink-500", border: "border-pink-500", dot: "bg-pink-400" },
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
 *
 * Colour is now *secondary* information: each criterion owns its own lane, so a
 * reviewer reads rows, not hues. That is what keeps a long recording legible —
 * eight saturated blocks stacked in one 56px bar read as noise, and the
 * playhead had nowhere to sit that wasn't behind them.
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

/** Width of the lane-label gutter. The scrub track and every lane share it so one playhead line crosses all of them. */
const GUTTER_PX = 116;

/** Playback speeds offered — a 90-minute recording is unwatchable at 1x. */
const PLAYBACK_RATES = [1, 1.5, 2];

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

/** Tick spacing that yields roughly 4–10 labelled marks for any recording length. */
function rulerStepSec(duration) {
  const steps = [5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  for (const s of steps) {
    if (duration / s <= 10) return s;
  }
  return steps[steps.length - 1];
}

/**
 * Video (or placeholder) with a scrub bar and a criteria track below it.
 *
 * Two separate surfaces on purpose:
 *  - the **scrub bar** is the video control (drag, click, keyboard, ±10s);
 *  - the **lanes** are evidence, one row per criterion.
 *
 * They used to be the same 56px block, which meant the playhead was a hairline
 * rendered *behind* the coloured bands (they animate to z-index 10/20; it had
 * none), and on a long recording the bands compressed into an unreadable
 * rainbow with no way to drag through it.
 *
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
 * @param {boolean} [highlightsPending] - Scoring still running; timeline bands are not in yet
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
  highlightsPending = false,
  className,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const [videoDurationSec, setVideoDurationSec] = useState(null);
  const [bufferedSec, setBufferedSec] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverPct, setHoverPct] = useState(null);
  // Clicking a lane label isolates that criterion; everything else dims so a
  // busy recording can be read one criterion at a time.
  const [focusedCategory, setFocusedCategory] = useState(null);
  const videoRef = useRef(null);
  const scrubRef = useRef(null);
  const resumeAfterScrubRef = useRef(false);
  // Live scrub preview: one seek in flight at a time, latest target wins.
  // Writing currentTime on every pointermove queues a precise seek per move;
  // while one is in flight the browser defers the rest, so the frame only
  // caught up when the drag stopped. The pump keeps the picture moving.
  const isScrubbingRef = useRef(false);
  const scrubTargetRef = useRef(null);
  const scrubSeekBusyRef = useRef(false);

  // Distinct categories in first-appearance order → stable colour per criterion.
  const categoryOrder = useMemo(
    () => [...new Set(highlights.map((h) => h.category).filter(Boolean))],
    [highlights]
  );
  const colorsFor = useCallback(
    (category) => {
      if (!category) return HIGHLIGHT_CATEGORY_COLORS.default;
      if (HIGHLIGHT_CATEGORY_COLORS[category]) {
        return HIGHLIGHT_CATEGORY_COLORS[category];
      }
      const idx = categoryOrder.indexOf(category);
      if (idx < 0) return HIGHLIGHT_CATEGORY_COLORS.default;
      return HIGHLIGHT_PALETTE[idx % HIGHLIGHT_PALETTE.length];
    },
    [categoryOrder]
  );

  // One lane per criterion, plus a trailing lane for uncategorised moments.
  const lanes = useMemo(() => {
    const indexed = highlights.map((h, i) => ({ ...h, i }));
    const rows = categoryOrder.map((cat) => ({
      key: cat,
      category: cat,
      items: indexed.filter((h) => h.category === cat),
    }));
    const loose = indexed.filter((h) => !h.category);
    if (loose.length > 0) {
      rows.push({ key: "__uncategorised__", category: null, items: loose });
    }
    return rows;
  }, [highlights, categoryOrder]);

  // Lanes shrink as criteria multiply so the track never outgrows the panel.
  const laneHeight = lanes.length > 8 ? 9 : lanes.length > 5 ? 12 : 16;

  // Reset duration when video source changes
  useEffect(() => {
    if (!videoUrl) setVideoDurationSec(null);
    scrubTargetRef.current = null;
    scrubSeekBusyRef.current = false;
  }, [videoUrl]);

  const hasVideoDuration =
    videoUrl && videoDurationSec != null && Number.isFinite(videoDurationSec) && videoDurationSec > 0;
  const hasHint = durationHintSec != null && Number.isFinite(durationHintSec) && durationHintSec > 0;
  const effectiveDuration = hasVideoDuration
    ? videoDurationSec
    : (videoUrl && hasHint ? durationHintSec : placeholderDurationSec);

  const pctOf = (sec) =>
    effectiveDuration > 0
      ? Math.max(0, Math.min(100, (sec / effectiveDuration) * 100))
      : 0;

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
    // Legacy un-remuxed recordings report Infinity duration; fall back to the
    // API's duration hint so an evidence seek can never target past the end of
    // the stream (an unclamped over-the-end seek leaves the element black).
    const d = video.duration;
    const knownDuration =
      Number.isFinite(d) && d > 0
        ? d
        : Number.isFinite(durationHintSec) && durationHintSec > 0
          ? durationHintSec
          : null;
    const target =
      knownDuration != null
        ? Math.max(0, Math.min(pending, knownDuration))
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
    // Mid-drag the pump owns the element; a precise seek here per state
    // update would serialize behind it and stall the live preview.
    if (isScrubbingRef.current) return;
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

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, videoUrl]);

  const seekTo = useCallback(
    (sec) => {
      const max = effectiveDuration;
      const clamped = Math.max(0, Math.min(sec, max));
      setCurrentSec(clamped);
      const video = videoRef.current;
      if (videoHasMetadata(video)) {
        video.currentTime = clamped;
      } else {
        pendingSeekRef.current = clamped;
      }
    },
    [effectiveDuration]
  );

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
    if (!Number.isFinite(sec)) return "0:00";
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  /* ------------------------------------------------------------------ */
  /* Scrubbing                                                           */
  /* ------------------------------------------------------------------ */

  const secFromClientX = useCallback(
    (clientX) => {
      const rect = scrubRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const pct = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, pct)) * effectiveDuration;
    },
    [effectiveDuration]
  );

  const pumpScrubSeek = (video = videoRef.current) => {
    if (!videoHasMetadata(video) || scrubSeekBusyRef.current) return;
    const target = scrubTargetRef.current;
    if (target == null) return;
    scrubTargetRef.current = null;
    scrubSeekBusyRef.current = true;
    // fastSeek lands on the nearest keyframe — inexact but quick, which is
    // what a moving picture under the cursor needs. endScrub restores
    // exactness with one precise seek.
    if (typeof video.fastSeek === "function") {
      try {
        video.fastSeek(target);
      } catch {
        video.currentTime = target;
      }
    } else {
      video.currentTime = target;
    }
  };

  // The video's onSeeked drains the pump: when a drag outran the last seek,
  // the freshest target goes out the moment the previous one lands.
  const handleVideoSeeked = (e) => {
    scrubSeekBusyRef.current = false;
    if (isScrubbingRef.current) pumpScrubSeek(e.target);
  };

  const previewSeek = (sec) => {
    const clamped = Math.max(0, Math.min(sec, effectiveDuration));
    setCurrentSec(clamped);
    const video = videoRef.current;
    if (!videoHasMetadata(video)) {
      pendingSeekRef.current = clamped;
      return;
    }
    scrubTargetRef.current = clamped;
    pumpScrubSeek(video);
  };

  const handleScrubPointerDown = (e) => {
    // Left button / touch / pen only.
    if (e.button != null && e.button !== 0) return;
    const sec = secFromClientX(e.clientX);
    if (sec == null) return;
    e.preventDefault();
    // Pointer capture keeps the drag alive when the cursor leaves the track.
    // It throws for a pointer id the element never saw (synthetic events, some
    // pen/touch edge cases), and an unguarded throw here would abort the whole
    // handler — i.e. the click would not seek at all.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* drag still works while the pointer stays over the track */
    }
    // Pause while dragging so playback does not fight the drag, then restore.
    resumeAfterScrubRef.current = isPlaying;
    if (isPlaying) setIsPlaying(false);
    setIsScrubbing(true);
    isScrubbingRef.current = true;
    previewSeek(sec);
  };

  const handleScrubPointerMove = (e) => {
    const sec = secFromClientX(e.clientX);
    if (sec == null) return;
    setHoverPct(pctOf(sec));
    if (!isScrubbing) return;
    e.preventDefault();
    previewSeek(sec);
  };

  const endScrub = (e) => {
    if (!isScrubbing) return;
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* nothing captured */
    }
    setIsScrubbing(false);
    isScrubbingRef.current = false;
    scrubTargetRef.current = null;
    scrubSeekBusyRef.current = false;
    // fastSeek previews are keyframe-approximate; land exactly where the
    // pointer let go. clientX is absent when a keyboard blur ends the drag —
    // fall back to where the preview already is.
    const sec = e?.clientX != null ? secFromClientX(e.clientX) : null;
    seekTo(sec != null ? sec : currentSec);
    if (resumeAfterScrubRef.current) {
      resumeAfterScrubRef.current = false;
      setIsPlaying(true);
    }
  };

  // Pointer events drive the drag; this is the fallback for anything that
  // delivers only a click (assistive tech, automation, a browser without
  // PointerEvent). Seeking to the same second twice is a no-op, so it is safe
  // to let both paths run.
  const handleScrubClick = (e) => {
    const sec = secFromClientX(e.clientX);
    if (sec == null) return;
    seekTo(sec);
  };

  const nudge = (delta) => seekTo(currentSec + delta);

  const handleScrubKeyDown = (e) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(step);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(-step);
    } else if (e.key === "Home") {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seekTo(effectiveDuration);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setIsPlaying((p) => !p);
    }
  };

  const ticks = useMemo(() => {
    if (!(effectiveDuration > 0)) return [];
    const step = rulerStepSec(effectiveDuration);
    const out = [];
    for (let t = 0; t <= effectiveDuration + 0.001; t += step) out.push(t);
    return out;
  }, [effectiveDuration]);

  const playheadPct = pctOf(currentSec);
  const bufferedPct = pctOf(bufferedSec);

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white overflow-hidden", className)}>
      {/* Video or placeholder */}
      <div className="relative aspect-video bg-gray-900">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            preload={seekToSec != null ? "auto" : "metadata"}
            className="w-full h-full object-contain"
            onClick={() => setIsPlaying((p) => !p)}
            onLoadedMetadata={(e) => {
              const d = e.target.duration;
              if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
              e.target.playbackRate = playbackRate;
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
            onProgress={(e) => {
              const b = e.target.buffered;
              if (b && b.length > 0) {
                try {
                  setBufferedSec(b.end(b.length - 1));
                } catch {
                  /* buffered ranges can throw on some codecs mid-load */
                }
              }
            }}
            onSeeked={handleVideoSeeked}
            onTimeUpdate={(e) => {
              // While dragging, state is the pointer position, not the (lagging,
              // keyframe-snapped) element time — writing the element time back
              // would make the knob jump away from the cursor.
              if (!isScrubbingRef.current) setCurrentSec(e.target.currentTime);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
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

      {/* Scrub bar — the video control, on its own row and never behind evidence. */}
      <div className="px-3 pt-3">
        <div
          ref={scrubRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek recording"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDuration)}
          aria-valuenow={Math.round(currentSec)}
          aria-valuetext={`${formatTime(currentSec)} of ${formatTime(effectiveDuration)}`}
          onPointerDown={handleScrubPointerDown}
          onClick={handleScrubClick}
          onPointerMove={handleScrubPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onPointerLeave={() => setHoverPct(null)}
          onKeyDown={handleScrubKeyDown}
          className="group relative py-2 cursor-pointer touch-none select-none outline-none"
        >
          <div className="relative h-1.5 rounded-full bg-gray-200">
            {/* Buffered */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gray-300"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Played */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#21201C]"
              style={{ width: `${playheadPct}%` }}
            />
            {/* Knob */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[#21201C] ring-2 ring-white shadow transition-transform",
                isScrubbing ? "w-4 h-4" : "w-3.5 h-3.5 group-hover:scale-110"
              )}
              style={{ left: `${playheadPct}%` }}
            />
          </div>
          {/* Hover time bubble */}
          {hoverPct != null && !isScrubbing ? (
            <span
              className="pointer-events-none absolute -top-4 -translate-x-1/2 rounded bg-[#21201C] px-1.5 py-0.5 text-[10px] font-mono text-white tabular-nums"
              style={{ left: `${hoverPct}%` }}
            >
              {formatTime((hoverPct / 100) * effectiveDuration)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => nudge(-10)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Back 10 seconds"
          title="Back 10s"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => nudge(10)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Forward 10 seconds"
          title="Forward 10s"
        >
          <RotateCw className="w-4 h-4" />
        </button>
        <span className="ml-1 text-xs font-mono text-gray-500 tabular-nums">
          {formatTime(currentSec)} / {formatTime(effectiveDuration)}
        </span>
        <div className="flex-1" />
        {videoUrl ? (
          <button
            type="button"
            onClick={() =>
              setPlaybackRate((r) => {
                const idx = PLAYBACK_RATES.indexOf(r);
                return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
              })
            }
            className="px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-500 text-xs font-mono tabular-nums"
            aria-label="Playback speed"
            title="Playback speed"
          >
            {playbackRate}×
          </button>
        ) : null}
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

      {/* Criteria track: one lane per criterion, ruler above, playhead over everything. */}
      <div className="border-t border-gray-100 px-3 py-3">
        <div className="relative" style={{ paddingLeft: GUTTER_PX }}>
          {/* Time ruler */}
          <div className="relative h-4 mb-1">
            {ticks.map((t, i) => {
              // Edge labels are anchored inward; a centred first/last tick is
              // half-clipped by the panel.
              const isFirst = i === 0;
              const isLast = i === ticks.length - 1;
              return (
                <span
                  key={t}
                  className={cn(
                    "absolute top-0 text-[9px] font-mono text-gray-400 tabular-nums",
                    isFirst ? "" : isLast ? "-translate-x-full" : "-translate-x-1/2"
                  )}
                  style={{ left: `${pctOf(t)}%` }}
                >
                  {formatTime(t)}
                </span>
              );
            })}
          </div>

          {highlights.length === 0 ? (
            <div className="flex h-10 items-center justify-center rounded-md bg-gray-50 text-[11px] text-gray-500">
              {highlightsPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                  Scoring still running — moments will appear here
                </span>
              ) : (
                "No scored moments on this recording"
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {lanes.map((lane) => {
                const c = colorsFor(lane.category);
                const dimmed =
                  focusedCategory != null && focusedCategory !== lane.key;
                return (
                  <div key={lane.key} className="relative">
                    {/* Lane label, parked in the gutter */}
                    <button
                      type="button"
                      onClick={() =>
                        setFocusedCategory((f) =>
                          f === lane.key ? null : lane.key
                        )
                      }
                      title={lane.category ?? "Other moments"}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-left text-[10px] leading-tight transition-opacity",
                        dimmed
                          ? "opacity-40 text-gray-400"
                          : "text-gray-600 hover:text-gray-900"
                      )}
                      style={{ left: -GUTTER_PX, width: GUTTER_PX - 8 }}
                    >
                      <span className={cn("w-2 h-2 rounded-full shrink-0", c.dot)} />
                      <span className="truncate">
                        {shortCategoryLabel(lane.category, 3)}
                      </span>
                      <span className="text-gray-400 shrink-0">
                        {lane.items.length}
                      </span>
                    </button>

                    {/* Lane track */}
                    <div
                      className={cn(
                        "relative rounded bg-gray-100 transition-opacity",
                        dimmed && "opacity-25"
                      )}
                      style={{ height: laneHeight }}
                    >
                      {lane.items.map((h) => {
                        const startPct = pctOf(h.startSec);
                        const isRange = h.endSec != null && h.endSec > h.startSec;
                        const endPct = pctOf(isRange ? h.endSec : h.startSec);
                        const isSelected = selectedHighlight === h.i;
                        return (
                          <button
                            key={h.i}
                            type="button"
                            className={cn(
                              "absolute inset-y-0 rounded-sm transition-all hover:opacity-100 hover:ring-2 hover:ring-[#21201C]/30",
                              c.bg,
                              isSelected
                                ? "opacity-100 ring-2 ring-[#21201C]/60 z-[15]"
                                : "opacity-65",
                              isRange ? "min-w-[3px]" : "w-[5px] -ml-[2px]"
                            )}
                            style={{
                              left: `${startPct}%`,
                              width: isRange
                                ? `${Math.max(0.4, endPct - startPct)}%`
                                : undefined,
                            }}
                            onClick={() => {
                              seekTo(h.startSec);
                              setSelectedHighlight(
                                selectedHighlight === h.i ? null : h.i
                              );
                            }}
                            title={`${formatTime(h.startSec)} — ${
                              h.category ? `${h.category}: ` : ""
                            }${h.label}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Playhead: one line across the ruler and every lane, above all bands. */}
          <div
            className="pointer-events-none absolute inset-y-0 z-30"
            style={{ left: GUTTER_PX, right: 0 }}
          >
            <div
              className="absolute top-3 bottom-0 w-px -translate-x-1/2 bg-[#21201C] shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
              style={{ left: `${playheadPct}%` }}
            >
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#21201C]" />
            </div>
          </div>
        </div>

        <p className="mt-2 text-[10px] text-gray-400">
          {highlightsPending && highlights.length === 0
            ? "Criteria moments land on these lanes once scoring finishes."
            : highlights.length > 0
              ? "Drag the bar above to scrub. Click a mark to jump to it, or a criterion name to isolate its lane."
              : "Drag the bar above to scrub."}
          {focusedCategory != null ? (
            <button
              type="button"
              onClick={() => setFocusedCategory(null)}
              className="ml-2 inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
            >
              <X className="w-3 h-3" aria-hidden />
              Show all lanes
            </button>
          ) : null}
        </p>
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
            <button
              type="button"
              onClick={() => setSelectedHighlight(null)}
              className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-400"
              aria-label="Close moment detail"
            >
              <X className="w-3.5 h-3.5" />
            </button>
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
