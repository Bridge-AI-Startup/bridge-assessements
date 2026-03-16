import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BoundingBoxOverlay from "@/components/proctoring/BoundingBoxOverlay";
import { Sparkles, Code, MessageSquare, TestTube } from "lucide-react";
import { cn } from "@/lib/utils";

/** Mock IDE layout: region boxes in % (same as DemoReplay). */
const DEMO_REGIONS = [
  { regionType: "file_tree", x: 0, y: 3, width: 14, height: 93, confidence: 0.95 },
  { regionType: "editor", x: 14, y: 3, width: 56, height: 55, confidence: 0.95 },
  { regionType: "terminal", x: 14, y: 58, width: 56, height: 38, confidence: 0.9 },
  { regionType: "ai_chat", x: 70, y: 3, width: 30, height: 93, confidence: 0.92 },
];

const PHASE_DURATION_MS = {
  scan: 1800,
  regions: 2200,
  insights: 3500,
  reset: 1200,
};

const INSIGHTS = [
  { label: "Code focus", icon: Code, color: "bg-blue-500/90" },
  { label: "AI assist", icon: MessageSquare, color: "bg-amber-500/90" },
  { label: "Tests run", icon: TestTube, color: "bg-emerald-500/90" },
];

/**
 * Landing section: animated "timeline + screen analysis" demo.
 * Loops: scan line → regions appear → mini timeline + insight pills → reset.
 * Starts when in view (optional).
 */
export default function LandingScreenAnalysis({ startWhenInView = true }) {
  const [phase, setPhase] = useState("scan"); // scan | regions | insights | reset
  const [scanComplete, setScanComplete] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [hasStarted, setHasStarted] = useState(!startWhenInView);
  const sectionRef = useRef(null);
  const loopRef = useRef(null);

  // Start animation when section enters viewport
  useEffect(() => {
    if (!startWhenInView) return;
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setHasStarted(true);
      },
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [startWhenInView]);

  // Phase loop
  useEffect(() => {
    if (!hasStarted) return;

    const runScan = () => {
      setPhase("scan");
      setScanComplete(false);
      setShowRegions(false);
      setShowInsights(false);
    };

    const toRegions = () => {
      setPhase("regions");
      setShowRegions(true);
    };

    const toInsights = () => {
      setPhase("insights");
      setShowInsights(true);
    };

    const toReset = () => {
      setPhase("reset");
      setShowRegions(false);
      setShowInsights(false);
    };

    if (phase === "scan") {
      loopRef.current = setTimeout(toRegions, PHASE_DURATION_MS.scan);
      return () => clearTimeout(loopRef.current);
    }
    if (phase === "regions") {
      loopRef.current = setTimeout(toInsights, PHASE_DURATION_MS.regions);
      return () => clearTimeout(loopRef.current);
    }
    if (phase === "insights") {
      loopRef.current = setTimeout(toReset, PHASE_DURATION_MS.insights);
      return () => clearTimeout(loopRef.current);
    }
    if (phase === "reset") {
      loopRef.current = setTimeout(runScan, PHASE_DURATION_MS.reset);
      return () => clearTimeout(loopRef.current);
    }
  }, [hasStarted, phase]);

  // Scan line completion (for "Detecting..." label)
  useEffect(() => {
    if (phase !== "scan") return;
    const t = setTimeout(() => setScanComplete(true), PHASE_DURATION_MS.scan);
    return () => clearTimeout(t);
  }, [phase]);

  const showScan = hasStarted && phase === "scan";

  return (
    <section
      ref={sectionRef}
      className="relative py-16 md:py-24 overflow-hidden"
    >
      <div className="max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            We analyze every moment on the screen
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Bridge detects editor, terminal, AI chat, and more—then maps activity to your evaluation criteria.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-gray-900 aspect-video"
        >
          {/* Fake screen content: subtle grid / code vibe */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
              `,
              backgroundSize: "20px 20px",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-gray-900/80 to-gray-950/80" />

          {/* Scan line + "Analyzing..." */}
          <AnimatePresence>
            {showScan && (
              <>
                <motion.div
                  className="absolute top-3 left-3 z-[8] px-3 py-1.5 rounded-lg text-xs font-medium text-white backdrop-blur-sm border border-white/20 flex items-center gap-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ backgroundColor: "rgba(30, 58, 138, 0.9)" }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Analyzing screen…
                </motion.div>
                <motion.div
                  className="absolute inset-x-0 h-1 z-[8] pointer-events-none"
                  initial={{ top: "0%" }}
                  animate={{ top: "100%" }}
                  transition={{
                    duration: 1.6,
                    ease: [0.32, 0.72, 0, 1],
                    delay: 0.2,
                  }}
                  onAnimationComplete={() => setScanComplete(true)}
                  style={{
                    background: "linear-gradient(to bottom, transparent, rgba(99, 102, 241, 0.6), transparent)",
                    boxShadow: "0 0 24px rgba(99, 102, 241, 0.5)",
                  }}
                />
              </>
            )}
          </AnimatePresence>

          {/* Region overlay (staggered demo style) */}
          <AnimatePresence>
            {showRegions && (
              <motion.div
                key="regions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 z-[5]"
              >
                <BoundingBoxOverlay
                  regions={DEMO_REGIONS}
                  variant="demo"
                  showLabels
                  className="rounded-2xl"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mini timeline bar + playhead (insights phase) */}
          <AnimatePresence>
            {showInsights && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[6] w-[85%] max-w-md"
              >
                <div className="h-2 rounded-full bg-gray-800/90 overflow-hidden">
                  <motion.div
                    className="h-full bg-indigo-500/80 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{
                      duration: PHASE_DURATION_MS.insights / 1000,
                      ease: "linear",
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-center mt-1.5">
                  Timeline · mapping activity to criteria
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Insight pills (during "insights" phase) */}
          <AnimatePresence>
            {showInsights && (
              <div className="absolute bottom-3 left-4 right-4 z-[7] flex flex-wrap gap-2 justify-center">
                {INSIGHTS.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.15, duration: 0.3 }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium text-white backdrop-blur-sm border border-white/20 flex items-center gap-2 shadow-lg",
                      item.color
                    )}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>

          {/* Playhead line on screen (moves with timeline) */}
          {showInsights && (
            <motion.div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500/70 pointer-events-none z-[4]"
              initial={{ left: "0%" }}
              animate={{ left: "100%" }}
              transition={{
                duration: PHASE_DURATION_MS.insights / 1000,
                ease: "linear",
              }}
            />
          )}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-sm text-gray-500 mt-4"
        >
          Timeline and region detection from a real session—no video required.
        </motion.p>
      </div>
    </section>
  );
}
