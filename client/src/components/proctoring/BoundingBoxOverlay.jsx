import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Terminal,
  FileCode,
  FolderTree,
  Globe,
  Box,
} from "lucide-react";

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

const REGION_ICONS = {
  ai_chat: MessageSquare,
  terminal: Terminal,
  editor: FileCode,
  file_tree: FolderTree,
  browser: Globe,
  other: Box,
};

/**
 * Regions in percentage (0–100): { regionType, x, y, width, height, confidence? }.
 * Renders as absolutely positioned divs over a container; container must be
 * position: relative and same aspect as the image/video (e.g. aspect-video).
 *
 * @param {Array<{ regionType: string, x: number, y: number, width: number, height: number, confidence?: number }>} regions
 * @param {boolean} [showLabels] - Show region type + confidence label
 * @param {Object} [regionColors] - Override REGION_COLORS per regionType
 * @param {string} [variant] - "default" | "demo" — demo adds icons, glow, staggered animation
 * @param {string} [className]
 */
export default function BoundingBoxOverlay({
  regions = [],
  showLabels = true,
  regionColors = REGION_COLORS,
  variant = "default",
  className,
}) {
  if (!regions.length) return null;

  const isDemo = variant === "demo";

  return (
    <div
      className={cn("absolute inset-0 pointer-events-none", className)}
      aria-hidden
    >
      {regions.map((region, i) => {
        const colors = regionColors[region.regionType] || regionColors.other;
        const Icon = REGION_ICONS[region.regionType] || REGION_ICONS.other;
        const confidence = region.confidence != null ? (region.confidence * 100).toFixed(0) : null;

        if (isDemo) {
          return (
            <motion.div
              key={i}
              className="absolute rounded-sm overflow-visible"
              style={{
                left: `${region.x}%`,
                top: `${region.y}%`,
                width: `${region.width}%`,
                height: `${region.height}%`,
              }}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.4,
                delay: i * 0.09,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div
                className="w-full h-full rounded-sm border-2 demo-region-glow"
                style={{
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                  boxShadow: `0 0 24px ${colors.border}50, inset 0 0 32px ${colors.border}15`,
                }}
              >
                {showLabels && (
                  <span
                    className="absolute top-0 left-0 text-[10px] font-semibold leading-none whitespace-nowrap flex items-center gap-1.5 px-2 py-1 rounded-br-md backdrop-blur-sm border-b border-r border-white/20"
                    style={{
                      backgroundColor: `${colors.border}ee`,
                      color: "white",
                    }}
                  >
                    <Icon className="w-3 h-3 shrink-0" strokeWidth={2.5} />
                    {colors.label}
                    {confidence != null && <> ({confidence}%)</>}
                  </span>
                )}
              </div>
            </motion.div>
          );
        }

        return (
          <div
            key={i}
            className="absolute rounded-sm"
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
                {confidence != null && <> ({confidence}%)</>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
