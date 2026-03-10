#!/usr/bin/env node
/**
 * Parses transcript generation logs (from terminal or a log file) and prints
 * a table of API call breakdown and rate-limit (429) counts.
 *
 * Usage:
 *   node scripts/parse-transcript-logs.js < terminals/2.txt
 *   cat server.log | node scripts/parse-transcript-logs.js
 */

import readline from "readline";
import { createReadStream } from "fs";

const stats = {
  visionCalls: { "gpt-4o-mini": 0, "gpt-4o": 0 },
  visionByRegion: { file_tree: 0, terminal: 0, editor: 0, ai_chat: 0, other: 0 },
  regionDetectCalls: 0,
  retries429: { "gpt-4o-mini": 0, "gpt-4o": 0, regionDetect: 0 },
  tesseractOnly: { file_tree: 0, terminal: 0, editor: 0, ai_chat: 0 },
  flushCount: { file_tree: 0, terminal: 0, editor: 0, ai_chat: 0 },
};

let lastFlushRegion = null; // region that triggered the next vision call (file_tree always does; terminal/editor/ai_chat when fallback)

function parseLine(line) {
  // [transcript] Flushing 3 file_tree crop(s) via OCR engine (model fallback: gpt-4o-mini)
  const flush = line.match(/Flushing \d+ (\w+)/);
  if (flush) {
    const region = flush[1];
    if (stats.flushCount[region] !== undefined) stats.flushCount[region]++;
    lastFlushRegion = region;
    return;
  }

  // [vision] Calling gpt-4o-mini with 3 images
  const visionCall = line.match(/\[vision\] Calling (gpt-4o-mini|gpt-4o) with/);
  if (visionCall) {
    const model = visionCall[1];
    stats.visionCalls[model] = (stats.visionCalls[model] || 0) + 1;
    if (lastFlushRegion && stats.visionByRegion[lastFlushRegion] !== undefined) {
      stats.visionByRegion[lastFlushRegion]++;
    } else if (lastFlushRegion) {
      stats.visionByRegion.other++;
    }
    return;
  }

  // [ocr] 3/3 crops fell back to vision API for terminal (confirms terminal used vision; we already counted via lastFlushRegion + vision call)
  const fallback = line.match(/crops fell back to vision API for (\w+)/);
  if (fallback) {
    // Already attributed when we saw the vision call; no double-count
    return;
  }

  // [ocr] 3/3 crops handled by Tesseract for editor
  const tesseract = line.match(/crops handled by Tesseract for (\w+)/);
  if (tesseract) {
    const region = tesseract[1];
    if (stats.tesseractOnly[region] !== undefined) stats.tesseractOnly[region]++;
    return;
  }

  // [retry] vision/gpt-4o-mini: rate limited (429)
  const retryVision = line.match(/\[retry\] vision\/(gpt-4o-mini|gpt-4o): rate limited \(429\)/);
  if (retryVision) {
    const model = retryVision[1];
    stats.retries429[model] = (stats.retries429[model] || 0) + 1;
    return;
  }

  // [retry] regionDetect/gpt-4o-mini: rate limited (429)
  if (line.includes("[retry] regionDetect/") && line.includes("429")) {
    stats.retries429.regionDetect++;
    return;
  }

  // [regionDetector] Detecting regions ...
  if (line.includes("[regionDetector] Detecting regions")) {
    stats.regionDetectCalls++;
  }
}

function printTable() {
  console.log("\n--- Transcript API call breakdown ---\n");

  console.log("Vision API calls by model:");
  console.log("  gpt-4o-mini:", stats.visionCalls["gpt-4o-mini"] || 0);
  console.log("  gpt-4o:     ", stats.visionCalls["gpt-4o"] || 0);
  console.log("  Total:      ", (stats.visionCalls["gpt-4o-mini"] || 0) + (stats.visionCalls["gpt-4o"] || 0));

  console.log("\nVision API calls by region (from 'fell back to vision' / file_tree always uses vision):");
  Object.entries(stats.visionByRegion).forEach(([region, n]) => {
    if (n > 0) console.log(`  ${region}: ${n}`);
  });
  const totalByRegion = Object.values(stats.visionByRegion).reduce((a, b) => a + b, 0);
  if (totalByRegion > 0) console.log("  (file_tree flushes always call vision; other regions only when Tesseract fallback)");

  console.log("\nRegion detection (layout) calls:", stats.regionDetectCalls);

  console.log("\n429 rate-limit retries:");
  console.log("  vision/gpt-4o-mini:", stats.retries429["gpt-4o-mini"] || 0);
  console.log("  vision/gpt-4o:     ", stats.retries429["gpt-4o"] || 0);
  console.log("  regionDetect:      ", stats.retries429.regionDetect || 0);
  console.log("  Total retries:     ", (stats.retries429["gpt-4o-mini"] || 0) + (stats.retries429["gpt-4o"] || 0) + (stats.retries429.regionDetect || 0));

  console.log("\nFlushes (batches) per region:", stats.flushCount);
  console.log("Tesseract-only (no API) per region:", stats.tesseractOnly);
  console.log("");
}

async function main() {
  const inputPath = process.argv[2];
  const input = inputPath
    ? createReadStream(inputPath, { encoding: "utf8" })
    : process.stdin;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) parseLine(line);
  printTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
