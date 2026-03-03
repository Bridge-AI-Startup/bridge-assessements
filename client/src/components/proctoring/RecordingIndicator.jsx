import { motion } from "framer-motion";
import { Monitor } from "lucide-react";

/**
 * Floating red recording badge shown when screen capture is active.
 * Displays number of active streams and a pulsing dot.
 */
export default function RecordingIndicator({ streamCount = 1 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      <Monitor className="w-3.5 h-3.5" />
      <span>
        Recording{streamCount > 1 ? ` (${streamCount})` : ""}
      </span>
    </motion.div>
  );
}
