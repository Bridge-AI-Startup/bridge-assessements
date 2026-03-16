import { motion } from "framer-motion";
import VideoTimelineWithCriteria from "@/components/proctoring/VideoTimelineWithCriteria";

/**
 * Reusable demo replay section: placeholder/screen + timeline with criteria highlights.
 * All data is hardcoded for demo / landing use. Use on Landing or standalone DemoReplay page.
 *
 * To generate real bounding box data:
 * GET /api/proctoring/sessions/:sessionId/debug-frames?maxFrames=1&detect=true (dev only).
 */
const DEMO_DURATION_SEC = 8 * 60; // 8 minutes

/** Transparent bounding box overlay for demo (percent 0–100). Typical IDE layout. */
export const DEMO_REGIONS = [
  { regionType: "file_tree", x: 0, y: 3, width: 14, height: 93, confidence: 0.95 },
  { regionType: "editor", x: 14, y: 3, width: 56, height: 55, confidence: 0.95 },
  { regionType: "terminal", x: 14, y: 58, width: 56, height: 38, confidence: 0.9 },
  { regionType: "ai_chat", x: 70, y: 3, width: 30, height: 93, confidence: 0.92 },
];

export const DEMO_HIGHLIGHTS = [
  { startSec: 12, endSec: 45, category: "Reads requirements", label: "Read problem and constraints", description: "Candidate scrolled through full spec and noted time limit.", score: 8 },
  { startSec: 48, endSec: 120, category: "Uses AI effectively", label: "Asked AI for structure, then edited", description: "Used Cursor to get a scaffold, then refactored naming and types.", score: 7 },
  { startSec: 95, category: "integrity", label: "Tab switch", description: "Brief switch to browser (documentation)." },
  { startSec: 125, endSec: 180, category: "Tests and debugs", label: "Wrote test and fixed edge case", description: "Added unit test for empty input; fixed off-by-one.", score: 9 },
  { startSec: 200, endSec: 260, category: "Code structure", label: "Extracted helper and error handling", description: "Pulled validation into a small function; added try/catch.", score: 8 },
  { startSec: 280, category: "integrity", label: "Window blur", description: "Window lost focus for a few seconds." },
  { startSec: 300, endSec: 340, category: "Uses AI effectively", label: "Reviewed AI suggestion before accepting", description: "Changed variable names and added a comment.", score: 8 },
];

/**
 * @param {Object} props
 * @param {string} [props.title] - Optional section title
 * @param {string} [props.description] - Optional description below title
 * @param {string} [props.footer] - Optional footer text (e.g. "For demo use only.")
 * @param {string} [props.className] - Wrapper class
 * @param {boolean} [props.animate] - Wrap title/description in motion.div (default true)
 * @param {string} [props.videoUrl] - Override video URL (default null = placeholder)
 * @param {string} [props.placeholderImageUrl] - Override placeholder image (default /placeholder-video.png)
 * @param {boolean} [props.interactive] - If false, timeline auto-plays and no clickable controls (for landing)
 */
export default function DemoReplaySection({
  title,
  description,
  footer,
  className,
  animate = true,
  videoUrl = null,
  placeholderImageUrl = "/placeholder-video.png",
  interactive = true,
  ...timelineProps
}) {
  const content = (
    <VideoTimelineWithCriteria
      durationSeconds={DEMO_DURATION_SEC}
      highlights={DEMO_HIGHLIGHTS}
      videoUrl={videoUrl}
      placeholderImageUrl={placeholderImageUrl}
      regions={DEMO_REGIONS}
      overlayVariant="demo"
      showDetectionScan
      className="shadow-lg"
      {...timelineProps}
      interactive={interactive}
    />
  );

  const Wrapper = animate ? motion.div : "div";
  const wrapperProps = animate ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } : {};

  return (
    <div className={className}>
      {(title || description) && (
        <Wrapper {...wrapperProps} className="mb-8">
          {title && <h2 className="text-2xl font-bold text-gray-900">{title}</h2>}
          {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
        </Wrapper>
      )}
      {content}
      {footer && <p className="text-xs text-gray-400 mt-4 text-center">{footer}</p>}
    </div>
  );
}
