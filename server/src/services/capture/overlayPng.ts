/**
 * Renders overlay regions to PNG (rects + optional labels).
 * Used by export-overlays API and exportBoundingBoxOverlays script.
 */

import sharp from "sharp";
import {
  buildRectsSvg,
  buildLabelSvg,
  REGION_COLORS,
  type OverlayRegion,
} from "./overlaySvg.js";

/** Rasterize one label SVG to a small PNG. */
async function renderLabelPng(
  label: string,
  borderColor: string,
  pixelHeight: number
): Promise<Buffer> {
  const svg = buildLabelSvg(label, borderColor);
  const w = Math.round((200 / 28) * pixelHeight);
  return sharp(Buffer.from(svg))
    .resize(w, pixelHeight)
    .png()
    .toBuffer();
}

/**
 * Render overlay PNG: rects at the given size, with optional labels composited.
 */
export async function renderOverlayPng(
  regions: OverlayRegion[],
  width: number,
  height: number,
  options: { labels?: boolean } = {}
): Promise<Buffer> {
  const svg = buildRectsSvg(regions);
  let pngBuffer = await sharp(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toBuffer();

  if (options.labels && regions.length > 0) {
    const labelPixelHeight = Math.max(20, Math.round(height * 0.022));
    const insetPx = Math.max(8, Math.round(width * 0.006));
    const composites: { input: Buffer; left: number; top: number }[] = [];

    for (const r of regions) {
      const colors = REGION_COLORS[r.regionType] ?? REGION_COLORS.other;
      const labelPng = await renderLabelPng(
        colors.label,
        colors.border,
        labelPixelHeight
      );
      const left = Math.round((r.x / 100) * width) + insetPx;
      const top = Math.round((r.y / 100) * height) + insetPx;
      composites.push({ input: labelPng, left, top });
    }

    pngBuffer = await sharp(pngBuffer)
      .composite(composites)
      .png()
      .toBuffer();
  }

  return pngBuffer;
}
