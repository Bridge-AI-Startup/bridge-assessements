/**
 * Shared SVG builder for bounding box overlay PNGs.
 * Used by the export-overlays API and the exportBoundingBoxOverlays script.
 */

export interface OverlayRegion {
  regionType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export const REGION_COLORS: Record<
  string,
  { border: string; bg: string; label: string }
> = {
  ai_chat: {
    border: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.25)",
    label: "AI Chat",
  },
  terminal: {
    border: "#10b981",
    bg: "rgba(16, 185, 129, 0.25)",
    label: "Terminal",
  },
  editor: {
    border: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.25)",
    label: "Editor",
  },
  file_tree: {
    border: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.25)",
    label: "File Tree",
  },
  browser: {
    border: "#ef4444",
    bg: "rgba(239, 68, 68, 0.25)",
    label: "Browser",
  },
  other: {
    border: "#6b7280",
    bg: "rgba(107, 114, 128, 0.25)",
    label: "Other",
  },
};

const RECT_STROKE_WIDTH = 0.25;

/** Build SVG string for overlay rects (viewBox 0 0 100 100, percent coordinates). */
export function buildRectsSvg(regions: OverlayRegion[]): string {
  const rects = regions
    .map((r) => {
      const colors = REGION_COLORS[r.regionType] ?? REGION_COLORS.other;
      return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${colors.bg}" stroke="${colors.border}" stroke-width="${RECT_STROKE_WIDTH}" rx="0.3"/>`;
    })
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  ${rects}
</svg>`;
}

/** Build SVG for a single label (one text element). Wide viewBox so long labels aren't clipped. */
export function buildLabelSvg(label: string, borderColor: string): string {
  const escaped = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 28" width="200" height="28" overflow="visible">
  <text x="6" y="20" font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="white" style="paint-order: stroke; stroke: ${borderColor}; stroke-width: 0.6;">${escaped}</text>
</svg>`;
}
