/**
 * Regenerate the Bridge brand PNGs from `brand/source/bridge-logo.svg`.
 *
 *   node brand/build.cjs
 *
 * Everything in `brand/logo/` and `brand/wordmark/` is derived — this script is
 * the only thing that should write into them.
 *
 * FONTS. The wordmark is set in Inter Medium, which does not ship with macOS.
 * sharp rasterizes SVG text through fontconfig, so without the real face the
 * lockups quietly come out in Helvetica — legible, but not the brand. Prepare
 * the faces once, then re-run with FONTCONFIG_PATH set:
 *
 *   mkdir -p /tmp/blfonts /tmp/blfc
 *   # URL from: curl "https://fonts.googleapis.com/css2?family=Inter:wght@500"
 *   curl -o /tmp/blfonts/Inter-Medium.ttf <inter 500 ttf url>
 *   cat > /tmp/blfc/fonts.conf <<'XML'
 *   <?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
 *   <fontconfig>
 *     <dir>/tmp/blfonts</dir>
 *     <dir>/System/Library/Fonts</dir>
 *     <cachedir>/tmp/blfc/cache</cachedir>
 *   </fontconfig>
 *   XML
 *   FONTCONFIG_PATH=/tmp/blfc node brand/build.cjs
 *
 * The script warns if it cannot find Inter, so a fallback render is never
 * mistaken for the real thing.
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
// sharp lives in server/, which is where it is installed — brand/ has no deps.
const sharp = createRequire(path.join(ROOT, "server", "package.json"))("sharp");

/** Bridge design tokens (see CLAUDE.md "Bridge design system"). */
const INK = "#21201C";
const CREAM = "#FAF9F2";
const PALE = "#DEDFE3"; // the mark's tint on dark surfaces

// Header proportions from client/src/pages/Landing.jsx: a 24px mark box beside
// 15px Inter Medium at -0.025em. Keeping these ratios is what makes the
// exported lockup and the live header read as the same wordmark.
const FONT_SIZE = 300;
const GAP = 90;
const CAP_HEIGHT_RATIO = 0.727; // Inter
const TRACKING = -0.025;

function warnIfInterMissing() {
  try {
    const out = execFileSync("fc-list", [":family=Inter"], { encoding: "utf8" });
    if (out.trim()) return;
  } catch {
    // fc-list absent — fall through to the warning rather than guessing.
  }
  console.warn(
    "! Inter not visible to fontconfig — the wordmark will render in a system\n" +
      "  face, not the brand. See the FONTS note at the top of this file."
  );
}

/** The mark is a base64 PNG wrapped in an <svg>; pull the raster back out. */
function markFromSource() {
  const svg = fs.readFileSync(path.join(__dirname, "source", "bridge-logo.svg"), "utf8");
  const m = svg.match(/href="data:image\/png;base64,([^"]+)"/);
  if (!m) throw new Error("no embedded PNG found in brand/source/bridge-logo.svg");
  return Buffer.from(m[1], "base64");
}

/** Recolor the ink mark to a flat tint, preserving its alpha. */
async function tint(markBuf, hex) {
  const { data, info } = await sharp(markBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

function lockupSvg(markPngBuf, markW, markH, color) {
  const pad = 120;
  const W = pad * 2 + markW + GAP + FONT_SIZE * 3.2;
  const H = pad * 2 + markH * 2;
  const cy = H / 2;
  const cap = CAP_HEIGHT_RATIO * FONT_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <image x="${pad}" y="${cy - markH / 2}" width="${markW}" height="${markH}" xlink:href="data:image/png;base64,${markPngBuf.toString("base64")}"/>
  <text x="${pad + markW + GAP}" y="${cy + cap / 2}" font-family="Inter" font-weight="500" font-size="${FONT_SIZE}" letter-spacing="${TRACKING * FONT_SIZE}" fill="${color}">Bridge</text>
</svg>`;
}

/** Trim to the artwork, then re-pad evenly so every export has the same margin. */
async function trimAndPad(buf, background) {
  const t = await sharp(buf).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const p = Math.round(t.info.height * 0.45);
  let out = sharp(t.data).extend({
    top: p,
    bottom: p,
    left: p,
    right: p,
    background: background || { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) out = out.flatten({ background });
  return out.png().toBuffer();
}

async function write(relPath, buf) {
  const abs = path.join(__dirname, relPath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf);
  const { width, height } = await sharp(buf).metadata();
  console.log(`  ${relPath}  ${width}x${height}`);
}

(async () => {
  warnIfInterMissing();

  const full = markFromSource();
  const trimmed = await sharp(full).trim({ threshold: 1 }).toBuffer();
  const { width: mw, height: mh } = await sharp(trimmed).metadata();

  const paleFull = await tint(full, PALE);
  const paleTrimmed = await tint(trimmed, PALE);

  console.log("mark:");
  await write("logo/bridge-logo-ink.png", full);
  await write("logo/bridge-logo-pale.png", paleFull);
  await write("logo/bridge-logo-ink-trimmed.png", trimmed);
  await write("logo/bridge-logo-pale-trimmed.png", paleTrimmed);

  // Mark alone on the cream field, square, artwork at ~46% of the canvas.
  const S = 1000;
  const w = Math.round(S * 0.46);
  const h = Math.round((mh / mw) * w);
  const scaled = await sharp(trimmed).resize(w, h).toBuffer();
  const onCream = await sharp({ create: { width: S, height: S, channels: 4, background: CREAM } })
    .composite([{ input: scaled, top: Math.round((S - h) / 2), left: Math.round((S - w) / 2) }])
    .png()
    .toBuffer();
  await write("logo/bridge-logo-ink-on-cream.png", onCream);

  console.log("wordmark:");
  for (const v of [
    { file: "wordmark/bridge-wordmark-ink.png", mark: trimmed, color: INK, bg: null },
    { file: "wordmark/bridge-wordmark-ink-on-cream.png", mark: trimmed, color: INK, bg: CREAM },
    { file: "wordmark/bridge-wordmark-pale.png", mark: paleTrimmed, color: PALE, bg: null },
  ]) {
    const raster = await sharp(Buffer.from(lockupSvg(v.mark, mw, mh, v.color))).png().toBuffer();
    await write(v.file, await trimAndPad(raster, v.bg));
  }
})();
