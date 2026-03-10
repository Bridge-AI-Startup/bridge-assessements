import { cn } from "@/lib/utils";

/**
 * Region type → border + transparent fill for overlay.
 * Matches server regionDetector output (ai_chat, terminal, editor, file_tree, browser, other).
 */
export const REGION_COLORS = {
  ai_chat: { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.2)", label: "AI Chat" },
  terminal: { border: "#10b981", bg: "rgba(16, 185, 129, 0.2)", label: "Terminal" },
  editor: { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.2)", label: "Editor" },
  file_tree: { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.2)", label: "File Tree" },
  browser: { border: "#ef4444", bg: "rgba(239, 68, 68, 0.2)", label: "Browser" },
  other: { border: "#6b7280", bg: "rgba(107, 114, 128, 0.2)", label: "Other" },
};

/**
 * Regions in percentage (0–100): { regionType, x, y, width, height, confidence? }.
 * Renders as absolutely positioned divs over a container; container must be
 * position: relative and same aspect as the image/video (e.g. aspect-video).
 *
 * @param {Array<{ regionType: string, x: number, y: number, width: number, height: number, confidence?: number }>} regions
 * @param {boolean} [showLabels] - Show region type + confidence label
 * @param {Object} [regionColors] - Override REGION_COLORS per regionType
 * @param {string} [className]
 */
export default function BoundingBoxOverlay({
  regions = [],
  showLabels = true,
  regionColors = REGION_COLORS,
  className,
}) {
  if (!regions.length) return null;

  return (
    <div
      className={cn("absolute inset-0 pointer-events-none", className)}
      aria-hidden
    >
      {regions.map((region, i) => {
        const colors = regionColors[region.regionType] || regionColors.other;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: `${region.width}%`,
              height: `${region.height}%`,
              border: `2px solid ${colors.border}`,
              backgroundColor: colors.bg,
            }}
          >
            {showLabels && (
              <span
                className="absolute top-0 left-0 text-[10px] font-semibold px-1 py-0.5 leading-none whitespace-nowrap"
                style={{
                  backgroundColor: colors.border,
                  color: "white",
                }}
              >
                {colors.label}
                {region.confidence != null && (
                  <> ({(region.confidence * 100).toFixed(0)}%)</>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
