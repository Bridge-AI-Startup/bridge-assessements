/**
 * Fixture generators. Everything is created at runtime (no binary blobs checked
 * in) and kept deliberately small to honour the "never analyze a 30-minute
 * video" / "reasonable time" constraints.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { PassThrough } from "stream";

import archiver from "archiver";
import { createWriteStream } from "fs";
import sharp from "sharp";

import { FIXTURES } from "./config.js";

export interface SyntheticFrame {
  buffer: Buffer;
  width: number;
  height: number;
  index: number;
}

/**
 * Generate N visually-distinct PNG frames that mimic an IDE screen (so the
 * vision model has real text/structure to transcribe, and so dedup keeps them).
 */
export async function generateSyntheticFrames(
  count = FIXTURES.syntheticFrameCount,
  width = FIXTURES.frameWidth,
  height = FIXTURES.frameHeight
): Promise<SyntheticFrame[]> {
  const frames: SyntheticFrame[] = [];
  for (let i = 0; i < count; i++) {
    const svg = ideFrameSvg(i, width, height);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    frames.push({ buffer, width, height, index: i });
  }
  return frames;
}

function ideFrameSvg(i: number, w: number, h: number): string {
  const lines = [
    `// step ${i + 1}: candidate edits server.ts`,
    `function handler_${i}(req, res) {`,
    `  const total = items_${i}.reduce((a, b) => a + b, ${i});`,
    `  return res.json({ ok: true, n: ${i}, total });`,
    `}`,
  ];
  const codeText = lines
    .map(
      (l, idx) =>
        `<text x="170" y="${70 + idx * 26}" font-family="monospace" font-size="15" fill="#d4d4d4">${escapeXml(
          l
        )}</text>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#1e1e1e"/>
    <rect x="0" y="0" width="160" height="${h}" fill="#252526"/>
    <text x="14" y="40" font-family="monospace" font-size="13" fill="#9cdcfe">EXPLORER</text>
    <text x="14" y="70" font-family="monospace" font-size="12" fill="#cccccc">src/</text>
    <text x="24" y="92" font-family="monospace" font-size="12" fill="#cccccc">server.ts</text>
    <text x="24" y="114" font-family="monospace" font-size="12" fill="#cccccc">utils_${i}.ts</text>
    <rect x="170" y="${h - 110}" width="${w - 190}" height="92" fill="#0c0c0c"/>
    <text x="180" y="${h - 86}" font-family="monospace" font-size="13" fill="#39d353">$ npm test  # run ${i + 1}</text>
    <text x="180" y="${h - 62}" font-family="monospace" font-size="13" fill="#cccccc">PASS  ${i + 1} of ${
      FIXTURES.syntheticFrameCount
    } suites</text>
    ${codeText}
  </svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Produce a real, decodable WebM clip via the bundled ffmpeg. This goes through
 * the genuine merge -> remux -> ffmpeg frame-extraction pipeline, so it counts
 * as a "real recording" even though its content is generated.
 */
export async function generateRealWebmClip(
  seconds = FIXTURES.realRecordingSeconds
): Promise<{ buffer: Buffer; path: string; cleanup: () => Promise<void> }> {
  const ffmpegPath = (await import("@ffmpeg-installer/ffmpeg")).default.path;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-webm-"));
  const out = path.join(dir, "clip.webm");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${seconds}:size=640x400:rate=10`,
      "-c:v",
      "libvpx",
      "-b:v",
      "200k",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))
    );
  });
  const buffer = await fs.readFile(out);
  return {
    buffer,
    path: out,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}

/** Build a tiny .zip code archive in-memory for the upload-submission path. */
export async function generateSampleRepoZip(): Promise<{
  buffer: Buffer;
  sha256: string;
}> {
  const files: Record<string, string> = {
    "README.md":
      "# E2E Sample Submission\n\nMinimal project used to exercise indexing + scoring.\n",
    "package.json": JSON.stringify(
      { name: "e2e-sample", version: "1.0.0", scripts: { test: "node test.js" } },
      null,
      2
    ),
    "src/index.js":
      "function sum(items){return items.reduce((a,b)=>a+b,0);}\nmodule.exports={sum};\n",
    "src/utils.js":
      "function clamp(n,lo,hi){return Math.max(lo,Math.min(hi,n));}\nmodule.exports={clamp};\n",
    "test.js":
      "const {sum}=require('./src/index');\nif(sum([1,2,3])!==6)throw new Error('fail');\nconsole.log('ok');\n",
  };

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });
    const sink = new PassThrough();
    sink.on("data", (c: Buffer) => chunks.push(c));
    sink.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.pipe(sink);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    archive.finalize();
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256 };
}

/** Write a buffer to disk under a dir, returning the path (for evidence). */
export async function writeArtifact(
  dir: string,
  name: string,
  data: Buffer | string
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await fs.writeFile(p, data);
  return p;
}

// Re-export so callers don't need their own import.
export { createWriteStream };
