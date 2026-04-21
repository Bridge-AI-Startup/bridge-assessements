import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Modal shown when screen share stream is lost or after reload (resume).
 * Prompts user to reshare their screen.
 */
export default function ResharePrompt({
  onReshare,
  onDismiss,
  title = "Screen Share Lost",
  subtitle = "Your screen recording has stopped.",
  body = "It looks like screen sharing was stopped. You can reshare your screen to continue recording, or dismiss this and continue without recording.",
}) {
  const [isResharing, setIsResharing] = useState(false);

  const handleReshare = async () => {
    setIsResharing(true);
    try {
      await onReshare();
    } finally {
      setIsResharing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">{body}</p>

        <div className="flex gap-3">
          <Button
            onClick={handleReshare}
            disabled={isResharing}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isResharing ? "animate-spin" : ""}`} />
            {isResharing ? "Resharing..." : "Reshare Screen"}
          </Button>
          <Button variant="outline" onClick={onDismiss} className="flex-1">
            <Monitor className="w-4 h-4 mr-2" />
            Continue Without
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
