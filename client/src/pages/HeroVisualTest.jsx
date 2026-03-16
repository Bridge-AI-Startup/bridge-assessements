import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import BridgeHeroWorkflowVisual from "@/components/landing/BridgeHeroWorkflowVisual";

/**
 * Dedicated page to view and test the Bridge hero workflow visual mockup.
 * Route: /HeroVisualTest
 */
export default function HeroVisualTest() {
  return (
    <div className="min-h-screen bg-gray-100/60">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Landing
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Hero workflow visual (test)
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Mockup for Bridge candidate workflow analysis. Use this page to tweak layout and copy.
        </p>
        <BridgeHeroWorkflowVisual />
      </div>
    </div>
  );
}
