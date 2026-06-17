/**
 * Generate a set of "convincing" human-coding stress videos for the transcript
 * pipeline and measure how many frames each would keep through the production
 * pixel-diff dedup (videoFrameExtractor thresholds).
 *
 * Run:  npm run gen:stress-videos      (from server/)
 *   or  npx tsx test/video-eval/generateStressVideos.ts
 *
 * Output (server/test/results/stress-videos/):
 *   <variant>.webm                 — the screencast (> 5 min)
 *   <variant>-sample-N.png         — 6 sample frames
 *   <variant>-montage.png          — 2x3 montage for quick review
 *   stress-videos-analysis.json    — per-video keep-rate / batch estimates
 *
 * Generation only — no transcript/eval is run. This is the approval gate.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
  renderStressVideo,
  STRESS_VARIANTS,
  type StressVideoResult,
} from "./humanCodingVideo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../results/stress-videos");

// Different durations (all 30+ min) + seeds reinforce cross-clip variance.
const PLAN: Record<string, { targetSeconds: number; fps: number; seed: number }> = {
  steady: { targetSeconds: 1860, fps: 3, seed: 1001 }, // 31:00
  bursty: { targetSeconds: 1950, fps: 3, seed: 2002 }, // 32:30
  ai_heavy: { targetSeconds: 1890, fps: 3, seed: 3003 }, // 31:30
  debug: { targetSeconds: 2010, fps: 3, seed: 4004 }, // 33:30
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  const results: StressVideoResult[] = [];

  // Optional fast smoke: STRESS_SECONDS=20 STRESS_ONLY=steady
  const secondsOverride = process.env.STRESS_SECONDS
    ? Number(process.env.STRESS_SECONDS)
    : undefined;
  const onlyVariant = process.env.STRESS_ONLY;
  const variants = onlyVariant
    ? STRESS_VARIANTS.filter((v) => v.variant === onlyVariant)
    : STRESS_VARIANTS;

  for (const meta of variants) {
    const plan = PLAN[meta.variant];
    if (secondsOverride) plan.targetSeconds = secondsOverride;
    const t0 = Date.now();
    process.stdout.write(
      `\n▶ Rendering "${meta.label}" (${meta.variant}) — ${plan.targetSeconds}s @ ${plan.fps}fps\n`
    );
    const result = await renderStressVideo({
      variant: meta.variant,
      label: meta.label,
      outDir: OUT_DIR,
      targetSeconds: plan.targetSeconds,
      fps: plan.fps,
      seed: plan.seed,
      onProgress: (done, total) => {
        const pct = ((done / total) * 100).toFixed(0);
        process.stdout.write(`\r   frames ${done}/${total} (${pct}%)   `);
      },
    });
    const renderMs = Date.now() - t0;
    process.stdout.write(
      `\r   ✓ ${result.totalFrames} frames in ${(renderMs / 1000).toFixed(0)}s | ` +
        `kept ${result.analysis.keptFrames}/${result.analysis.candidateFrames} ` +
        `(${fmtPct(result.analysis.keepRate)}) → ~${result.analysis.estimatedBatches} vision batches | ` +
        `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB\n`
    );
    results.push(result);
  }

  // Cross-clip variance metrics
  const keepRates = results.map((r) => r.analysis.keepRate);
  const minKeep = Math.min(...keepRates);
  const maxKeep = Math.max(...keepRates);
  const mean = keepRates.reduce((a, b) => a + b, 0) / keepRates.length;
  const variance =
    keepRates.reduce((a, b) => a + (b - mean) ** 2, 0) / keepRates.length;

  const summary = {
    generatedAt: startedAt.toISOString(),
    outputDir: OUT_DIR,
    extractorThresholds: {
      candidateIntervalSec: 0.5,
      thumbSize: 128,
      diffThreshold: 0.005,
      channelThreshold: 25,
      note: "Matches server/src/services/capture/videoFrameExtractor.ts exactly.",
    },
    crossClipVariance: {
      minKeepRate: minKeep,
      maxKeepRate: maxKeep,
      meanKeepRate: mean,
      stdDevKeepRate: Math.sqrt(variance),
      spread: maxKeep - minKeep,
    },
    videos: results.map((r) => ({
      variant: r.variant,
      label: r.label,
      description:
        STRESS_VARIANTS.find((v) => v.variant === r.variant)?.description ?? "",
      file: r.path,
      montage: r.montagePath,
      sampleFrames: r.sampleFrames,
      durationSeconds: r.durationSeconds,
      durationLabel: `${Math.floor(r.durationSeconds / 60)}:${String(r.durationSeconds % 60).padStart(2, "0")}`,
      overFiveMinutes: r.durationSeconds > 300,
      overThirtyMinutes: r.durationSeconds >= 1800,
      fps: r.fps,
      totalFrames: r.totalFrames,
      sizeMB: +(r.sizeBytes / 1024 / 1024).toFixed(2),
      featureFrames: r.featureFrames,
      analysis: r.analysis,
    })),
  };

  const summaryPath = path.join(OUT_DIR, "stress-videos-analysis.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

  process.stdout.write("\n──────────────── SUMMARY ────────────────\n");
  for (const v of summary.videos) {
    process.stdout.write(
      `${v.label.padEnd(16)} ${v.durationLabel}  ` +
        `keep ${fmtPct(v.analysis.keepRate)}  ` +
        `~${v.analysis.estimatedBatches} batches  ${v.sizeMB}MB  ` +
        `[browser ${v.featureFrames.browser}f, popup ${v.featureFrames.autocomplete}f, ` +
        `AI-inline ${v.featureFrames.aiInline}f, CmdK ${v.featureFrames.cmdk}f]\n`
    );
  }
  process.stdout.write(
    `\nCross-clip keep-rate spread: ${fmtPct(minKeep)} → ${fmtPct(maxKeep)} ` +
      `(stddev ${fmtPct(Math.sqrt(variance))})\n`
  );
  process.stdout.write(`\nAnalysis written to ${summaryPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
