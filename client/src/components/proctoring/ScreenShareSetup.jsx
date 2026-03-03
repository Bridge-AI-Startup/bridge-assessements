import { useState } from "react";
import { motion } from "framer-motion";
import { Monitor, Plus, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Step-by-step UI to add multiple getDisplayMedia streams.
 * Shows list of active screens and allows adding more.
 */
export default function ScreenShareSetup({
  streams,
  onAddScreen,
  onDone,
  error,
}) {
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      await onAddScreen();
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-xl p-8"
    >
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-purple-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Screen Setup</h2>
        <p className="text-sm text-gray-500 mt-2">
          Share one or more screens for recording. You can add additional
          monitors if you use multiple displays.
        </p>
      </div>

      {/* Active screens list */}
      <div className="space-y-2 mb-6">
        {streams.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg"
          >
            <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="text-sm text-green-800 font-medium">
              {s.label || `Screen ${i + 1}`}
            </span>
          </div>
        ))}

        {streams.length === 0 && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
            <p className="text-sm text-gray-500">No screens shared yet</p>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={handleAdd}
          disabled={isAdding}
          variant="outline"
          className="flex-1"
        >
          <Plus className="w-4 h-4 mr-2" />
          {isAdding
            ? "Selecting..."
            : streams.length === 0
            ? "Share Screen"
            : "Add Another Screen"}
        </Button>
        {streams.length > 0 && (
          <Button
            onClick={onDone}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
          >
            <ArrowRight className="w-4 h-4 mr-2" />
            Continue
          </Button>
        )}
      </div>
    </motion.div>
  );
}
