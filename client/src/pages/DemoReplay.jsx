import { motion } from "framer-motion";
import VideoTimelineWithCriteria from "@/components/proctoring/VideoTimelineWithCriteria";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Demo page: video placeholder + timeline with criteria highlights.
 * All data is hardcoded for demo / recording purposes.
 *
 * To generate real bounding box data for your own screenshot:
 * 1. Create a proctoring session and upload frames (or use an existing session).
 * 2. Call GET /api/proctoring/sessions/:sessionId/debug-frames?maxFrames=1&detect=true (dev only).
 * 3. Use response.frames[0].regions — each region has { regionType, x, y, width, height, confidence } (percent).
 * 4. Or run region detection in a script: server uses server/src/ai/transcript/regionDetector.ts (detectRegions).
 */
const DEMO_DURATION_SEC = 8 * 60; // 8 minutes

/** Transparent bounding box overlay for demo (percent 0–100). Typical IDE layout. */
const DEMO_REGIONS = [
  { regionType: "file_tree", x: 0, y: 3, width: 14, height: 93, confidence: 0.95 },
  { regionType: "editor", x: 14, y: 3, width: 56, height: 55, confidence: 0.95 },
  { regionType: "terminal", x: 14, y: 58, width: 56, height: 38, confidence: 0.9 },
  { regionType: "ai_chat", x: 70, y: 3, width: 30, height: 93, confidence: 0.92 },
];

const DEMO_HIGHLIGHTS = [
  { startSec: 12, endSec: 45, category: "Reads requirements", label: "Read problem and constraints", description: "Candidate scrolled through full spec and noted time limit.", score: 8 },
  { startSec: 48, endSec: 120, category: "Uses AI effectively", label: "Asked AI for structure, then edited", description: "Used Cursor to get a scaffold, then refactored naming and types.", score: 7 },
  { startSec: 95, category: "integrity", label: "Tab switch", description: "Brief switch to browser (documentation)." },
  { startSec: 125, endSec: 180, category: "Tests and debugs", label: "Wrote test and fixed edge case", description: "Added unit test for empty input; fixed off-by-one.", score: 9 },
  { startSec: 200, endSec: 260, category: "Code structure", label: "Extracted helper and error handling", description: "Pulled validation into a small function; added try/catch.", score: 8 },
  { startSec: 280, category: "integrity", label: "Window blur", description: "Window lost focus for a few seconds." },
  { startSec: 300, endSec: 340, category: "Uses AI effectively", label: "Reviewed AI suggestion before accepting", description: "Changed variable names and added a comment.", score: 8 },
];

export default function DemoReplay() {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold text-gray-900">
            Screen recording with criteria timeline
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Demo: timeline highlights map to evaluation criteria and integrity events. Click a highlight to jump and see details.
          </p>
        </motion.div>

        <VideoTimelineWithCriteria
          durationSeconds={DEMO_DURATION_SEC}
          highlights={DEMO_HIGHLIGHTS}
          videoUrl={null}
          placeholderImageUrl="/placeholder-video.png"
          regions={DEMO_REGIONS}
          className="shadow-lg"
        />

        <p className="text-xs text-gray-400 mt-4 text-center">
          For demo use only. Replace with real session + evaluation report when pipeline is ready.
        </p>
      </div>
    </div>
  );
}
