import { cn } from "@/lib/utils";

/**
 * Region type → border + transparent fill for overlay.
 * Matches server regionDetector output (ai_chat, terminal, editor, file_tree, browser, other).
 *
 * These are data-encoding colors drawn over candidate screenshots, so they stay
 * six distinguishable hues rather than collapsing to the monochrome brand ramp.
 * They are desaturated and warmed to sit alongside the Bridge palette.
 */
export const REGION_COLORS = {
  ai_chat: { border: "#d69b31", bg: "rgba(214, 155, 49, 0.2)", label: "AI Chat" },
  terminal: { border: "#6d955e", bg: "rgba(109, 149, 94, 0.2)", label: "Terminal" },
  editor: { border: "#4a7ca8", bg: "rgba(74, 124, 168, 0.2)", label: "Editor" },
  file_tree: { border: "#8c6ba8", bg: "rgba(140, 107, 168, 0.2)", label: "File Tree" },
  browser: { border: "#d06e61", bg: "rgba(208, 110, 97, 0.2)", label: "Browser" },
  other: { border: "#8a867b", bg: "rgba(138, 134, 123, 0.2)", label: "Other" },
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
