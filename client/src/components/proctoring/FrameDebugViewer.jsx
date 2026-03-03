import { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Layers,
  Eye,
  EyeOff,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDebugFrames } from "@/api/proctoring";

// Region type → color mapping for bounding box overlays
const REGION_COLORS = {
  ai_chat: { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", label: "AI Chat" },
  terminal: { border: "#10b981", bg: "rgba(16, 185, 129, 0.15)", label: "Terminal" },
  editor: { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)", label: "Editor" },
  file_tree: { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.15)", label: "File Tree" },
  browser: { border: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", label: "Browser" },
  other: { border: "#6b7280", bg: "rgba(107, 114, 128, 0.15)", label: "Other" },
};

/**
 * Frame-by-frame debug viewer for proctoring transcript debugging.
 * Shows extracted frames with region detection bounding box overlays,
 * cropped region thumbnails, and matched transcript segments.
 */
export default function FrameDebugViewer({ sessionId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showBoxes, setShowBoxes] = useState(true);
  const [selectedCrop, setSelectedCrop] = useState(null);
  const [runDetection, setRunDetection] = useState(true);

  const loadFrames = async () => {
    setLoading(true);
    setError(null);
    const result = await getDebugFrames(sessionId, {
      maxFrames: 30,
      detect: runDetection,
    });
    if (result.success) {
      setData(result.data);
      setCurrentFrame(0);
      setSelectedCrop(null);
    } else {
      setError(result.error || "Failed to load debug frames");
    }
    setLoading(false);
  };

  const frame = data?.frames?.[currentFrame];

  // Match transcript segments to current frame by timestamp proximity
  const matchedSegments = useMemo(() => {
    if (!frame || !data?.transcriptSegments) return [];
    const frameTime = new Date(frame.capturedAt).getTime();
    return data.transcriptSegments.filter((seg) => {
      const segStart = new Date(seg.ts).getTime();
      const segEnd = seg.ts_end ? new Date(seg.ts_end).getTime() : segStart + 1000;
      // Frame falls within segment time range (with 1s tolerance)
      return frameTime >= segStart - 1000 && frameTime <= segEnd + 1000;
    });
  }, [frame, data?.transcriptSegments]);

  if (!sessionId) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            Frame Debug Viewer
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={runDetection}
              onChange={(e) => setRunDetection(e.target.checked)}
              className="rounded"
            />
            Run region detection
          </label>
          <Button
            size="sm"
            onClick={loadFrames}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Eye className="w-3 h-3 mr-1" />
            )}
            {data ? "Reload" : "Load Frames"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span>
            {runDetection
              ? "Extracting frames & running region detection..."
              : "Extracting frames..."}
          </span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg px-3 py-2">
            <span>
              Total frames: <strong>{data.totalFrames}</strong>
            </span>
            <span>
              Sampled: <strong>{data.sampledCount}</strong>
            </span>
            <span>
              Transcript segments: <strong>{data.transcriptSegments?.length || 0}</strong>
            </span>
            {data.tokenUsage && (
              <span>
                Tokens: <strong>{data.tokenUsage.total?.toLocaleString()}</strong>
              </span>
            )}
          </div>

          {frame && (
            <>
              {/* Frame navigation */}
              <div className="flex items-center justify-between mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentFrame((c) => Math.max(0, c - 1))}
                  disabled={currentFrame === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-sm text-gray-600">
                  Frame{" "}
                  <span className="font-mono font-bold">
                    {currentFrame + 1}
                  </span>{" "}
                  / {data.frames.length}
                  <span className="text-gray-400 ml-2">
                    (#{frame.index}) {new Date(frame.capturedAt).toLocaleTimeString()}
                  </span>
                  <span className="text-gray-400 ml-2">
                    {frame.width}x{frame.height}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCurrentFrame((c) =>
                      Math.min(data.frames.length - 1, c + 1)
                    )
                  }
                  disabled={currentFrame === data.frames.length - 1}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Main frame with bounding box overlay */}
              <div className="relative bg-gray-900 rounded-lg overflow-hidden mb-4">
                <img
                  src={frame.thumbnail}
                  alt={`Frame ${currentFrame + 1}`}
                  className="w-full"
                  style={{ imageRendering: "auto" }}
                />

                {/* Bounding box overlays */}
                {showBoxes &&
                  frame.regions?.map((region, i) => {
                    const colors =
                      REGION_COLORS[region.regionType] || REGION_COLORS.other;
                    return (
                      <div
                        key={i}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${region.x}%`,
                          top: `${region.y}%`,
                          width: `${region.width}%`,
                          height: `${region.height}%`,
                          border: `2px solid ${colors.border}`,
                          backgroundColor: colors.bg,
                        }}
                      >
                        <span
                          className="absolute top-0 left-0 text-[10px] font-bold px-1 py-0.5 leading-none"
                          style={{
                            backgroundColor: colors.border,
                            color: "white",
                          }}
                        >
                          {colors.label} ({(region.confidence * 100).toFixed(0)}%)
                        </span>
                      </div>
                    );
                  })}

                {/* Toggle overlay button */}
                <button
                  onClick={() => setShowBoxes((b) => !b)}
                  className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded"
                  title={showBoxes ? "Hide boxes" : "Show boxes"}
                >
                  {showBoxes ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Detection error */}
              {frame.detectionError && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700 mb-4">
                  Detection error: {frame.detectionError}
                </div>
              )}

              {/* Region crops */}
              {frame.crops?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Cropped Regions ({frame.crops.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {frame.crops.map((crop, i) => {
                      const colors =
                        REGION_COLORS[crop.regionType] || REGION_COLORS.other;
                      const isSelected = selectedCrop === i;
                      return (
                        <button
                          key={i}
                          onClick={() =>
                            setSelectedCrop(isSelected ? null : i)
                          }
                          className={`text-left rounded-lg border-2 overflow-hidden transition-all ${
                            isSelected
                              ? "border-purple-500 ring-2 ring-purple-200"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div
                            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
                            style={{
                              backgroundColor: colors.bg,
                              color: colors.border,
                            }}
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: colors.border }}
                            />
                            {colors.label}
                            <span className="text-gray-400 ml-auto">
                              {(crop.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <img
                            src={crop.thumbnail}
                            alt={crop.regionType}
                            className={`w-full ${isSelected ? "" : "max-h-32 object-cover object-top"}`}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Expanded crop view */}
              {selectedCrop !== null && frame.crops?.[selectedCrop] && (
                <div className="mb-4 rounded-lg border border-purple-200 overflow-hidden">
                  <div className="bg-purple-50 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-purple-700">
                      <Maximize2 className="w-3 h-3 inline mr-1" />
                      {REGION_COLORS[frame.crops[selectedCrop].regionType]?.label || frame.crops[selectedCrop].regionType} — Full Crop
                    </span>
                    <button
                      onClick={() => setSelectedCrop(null)}
                      className="text-xs text-purple-500 hover:text-purple-700"
                    >
                      Close
                    </button>
                  </div>
                  <img
                    src={frame.crops[selectedCrop].thumbnail}
                    alt="Expanded crop"
                    className="w-full"
                  />
                </div>
              )}

              {/* Matched transcript segments */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Matched Transcript Segments ({matchedSegments.length})
                </h3>
                {matchedSegments.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    No transcript segments match this frame's timestamp.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {matchedSegments.map((seg, i) => {
                      const colors =
                        REGION_COLORS[seg.region] || REGION_COLORS.other;
                      return (
                        <div
                          key={i}
                          className="rounded-lg border p-2 text-xs"
                          style={{ borderColor: colors.border }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="px-1.5 py-0.5 rounded text-white text-[10px] font-bold"
                              style={{ backgroundColor: colors.border }}
                            >
                              {seg.region || "unknown"}
                            </span>
                            <span className="text-gray-400">
                              {seg.app || ""}
                            </span>
                            <span className="text-gray-300 ml-auto font-mono">
                              {seg.ts?.split("T")[1]?.slice(0, 8)}
                            </span>
                          </div>
                          <pre className="text-gray-600 whitespace-pre-wrap break-words max-h-24 overflow-auto font-mono text-[10px] leading-tight">
                            {seg.text_content?.slice(0, 500)}
                            {seg.text_content?.length > 500 ? "..." : ""}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Region legend */}
              <div className="mt-4 flex flex-wrap gap-3 text-[10px]">
                {Object.entries(REGION_COLORS).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded border-2"
                      style={{
                        borderColor: val.border,
                        backgroundColor: val.bg,
                      }}
                    />
                    <span className="text-gray-500">{val.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.frames.length === 0 && (
            <p className="text-center text-gray-400 py-8">
              No frames extracted. Make sure the session has video chunks or screenshots.
            </p>
          )}
        </>
      )}
    </div>
  );
}
