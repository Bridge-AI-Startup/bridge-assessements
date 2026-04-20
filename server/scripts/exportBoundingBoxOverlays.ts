/**
 * Export transparent PNG overlays of bounding box regions for use in CapCut
 * (or any editor). Layer the PNG on top of your screen recording and fade it in.
 *
 * Usage (from server dir):
 *
 *   # Hardcoded demo layout (no API calls):
 *   npx tsx scripts/exportBoundingBoxOverlays.ts [width] [height]
 *
 *   # Run frame-debugger region detection on an image, then export PNGs:
 *   npx tsx scripts/exportBoundingBoxOverlays.ts --image path/to/screenshot.png [width] [height]
 *
 *   # Run detection on first frame of a proctoring session, then export PNGs:
 *   npx tsx scripts/exportBoundingBoxOverlays.ts --session <sessionId> [width] [height]
 *
 * Output: client/public/demo-overlays/
 *   - bounding-boxes-overlay.png, file_tree.png, editor.png, terminal.png, ai_chat.png, browser.png (if detected)
 *
 * For --image and --session, width/height default to the source image/frame size.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const configPath = path.resolve(__dirname, "../config.env");
  if (fs.existsSync(configPath)) {
    config({ path: configPath });
  } else {
    config({ path: path.resolve(process.cwd(), "config.env") });
  }
}

import type { OverlayRegion } from "../src/services/capture/overlaySvg.js";
import { renderOverlayPng } from "../src/services/capture/overlayPng.js";

const DEMO_REGIONS: OverlayRegion[] = [
  {
    regionType: "file_tree",
    x: 0,
    y: 3,
    width: 14,
    height: 93,
    confidence: 0.95,
  },
  {
    regionType: "editor",
    x: 14,
    y: 3,
    width: 56,
    height: 55,
    confidence: 0.95,
  },
  {
    regionType: "terminal",
    x: 14,
    y: 58,
    width: 56,
    height: 38,
    confidence: 0.9,
  },
  {
    regionType: "ai_chat",
    x: 70,
    y: 3,
    width: 30,
    height: 93,
    confidence: 0.92,
  },
];

/** Run frame-debugger region detection on an image file. Returns regions (percent) and image dimensions. */
async function getRegionsFromImage(
  imagePath: string
): Promise<{ regions: OverlayRegion[]; width: number; height: number }> {
  loadEnv();
  const buf = fs.readFileSync(imagePath);
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 1920;
  const height = meta.height ?? 1080;
  const { detectRegions } = await import("../src/ai/transcript/regionDetector.js");
  const { regions } = await detectRegions({
    buffer: buf,
    capturedAt: new Date(),
    screenIndex: 0,
  });
  return { regions, width, height };
}

/** Run region detection on the first frame of a proctoring session (same as frame debugger). */
async function getRegionsFromSession(
  sessionId: string
): Promise<{ regions: OverlayRegion[]; width: number; height: number }> {
  loadEnv();
  const connectMongoose = (await import("../src/db/mongooseConnection.js")).default;
  await connectMongoose();
  const { prepareSessionForTranscript } = await import(
    "../src/services/capture/framePrep.js"
  );
  const { detectRegions } = await import("../src/ai/transcript/regionDetector.js");
  const prepared = await prepareSessionForTranscript(sessionId);
  if (!prepared.frames.length) {
    throw new Error(`Session ${sessionId} has no frames.`);
  }
  const frame = prepared.frames[0];
  const { regions } = await detectRegions({
    buffer: frame.buffer,
    capturedAt: frame.capturedAt,
    screenIndex: frame.screenIndex,
  });
  return { regions, width: frame.width, height: frame.height };
}

function parseArgs(): {
  mode: "demo" | "image" | "session";
  imagePath?: string;
  sessionId?: string;
  width: number;
  height: number;
} {
  const args = process.argv.slice(2);
  let width = 1920;
  let height = 1080;
  let mode: "demo" | "image" | "session" = "demo";
  let imagePath: string | undefined;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--image" && args[i + 1]) {
      mode = "image";
      imagePath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === "--session" && args[i + 1]) {
      mode = "session";
      sessionId = args[i + 1];
      i++;
    } else if (/^\d+$/.test(args[i]) && /^\d+$/.test(args[i + 1] || "")) {
      width = parseInt(args[i], 10);
      height = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { mode, imagePath, sessionId, width, height };
}

async function exportRegions(
  regions: OverlayRegion[],
  width: number,
  height: number,
  outDir: string
): Promise<void> {
  if (regions.length === 0) {
    console.log("No regions to export.");
    return;
  }

  const pngBuffer = await renderOverlayPng(regions, width, height, {
    labels: true,
  });
  fs.writeFileSync(path.join(outDir, "bounding-boxes-overlay.png"), pngBuffer);
  console.log(`Wrote bounding-boxes-overlay.png (${width}x${height})`);

  for (const region of regions) {
    const oneBuffer = await renderOverlayPng([region], width, height, {
      labels: true,
    });
    const safeName = region.regionType.replace(/[^a-z0-9_]/gi, "_");
    fs.writeFileSync(path.join(outDir, `${safeName}.png`), oneBuffer);
    console.log(`Wrote ${safeName}.png`);
  }
}

async function main() {
  const { mode, imagePath, sessionId, width, height } = parseArgs();

  const outDir = path.resolve(__dirname, "../../client/public/demo-overlays");
  fs.mkdirSync(outDir, { recursive: true });

  let regions: OverlayRegion[];
  let outWidth = width;
  let outHeight = height;

  if (mode === "image" && imagePath) {
    if (!fs.existsSync(imagePath)) {
      console.error("Image not found:", imagePath);
      process.exit(1);
    }
    console.log("Running region detection on image:", imagePath);
    const result = await getRegionsFromImage(imagePath);
    regions = result.regions;
    outWidth = result.width;
    outHeight = result.height;
    if (width !== 1920 || height !== 1080) {
      outWidth = width;
      outHeight = height;
    }
  } else if (mode === "session" && sessionId) {
    console.log("Loading session and running region detection:", sessionId);
    const result = await getRegionsFromSession(sessionId);
    regions = result.regions;
    outWidth = result.width;
    outHeight = result.height;
    if (width !== 1920 || height !== 1080) {
      outWidth = width;
      outHeight = height;
    }
  } else {
    regions = DEMO_REGIONS;
    outWidth = width;
    outHeight = height;
    // Also export standalone browser full-screen for demo (with label)
    const browserBuffer = await renderOverlayPng(
      [{ regionType: "browser", x: 0, y: 0, width: 100, height: 100 }],
      outWidth,
      outHeight,
      { labels: true }
    );
    fs.writeFileSync(path.join(outDir, "browser.png"), browserBuffer);
    console.log("Wrote browser.png (full-screen)");
  }

  await exportRegions(regions, outWidth, outHeight, outDir);
  console.log("\nDone. Overlays include boxes and labels.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
