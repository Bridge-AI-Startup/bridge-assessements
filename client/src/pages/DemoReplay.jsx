import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import DemoReplaySection from "@/components/landing/DemoReplaySection";

/**
 * Demo page: video placeholder + timeline with criteria highlights.
 * Uses DemoReplaySection component (same section can be embedded on Landing).
 */
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

        <DemoReplaySection
          title="Screen recording with criteria timeline"
          description="Demo: timeline highlights map to evaluation criteria and integrity events. Click a highlight to jump and see details."
          footer="For demo use only. Replace with real session + evaluation report when pipeline is ready."
          animate
        />
      </div>
    </div>
  );
}
