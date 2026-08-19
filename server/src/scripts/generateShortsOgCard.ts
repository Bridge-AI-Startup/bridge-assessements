/**
 * Generate the Bridge Shorts social share card (og:image).
 *
 *   cd server && npx tsx src/scripts/generateShortsOgCard.ts
 *
 * Writes a 1200x630 PNG to `shorts/client/public/og/shorts-card.png`, which
 * Vercel serves at `<Shorts client base>/og/shorts-card.png` — the URL
 * `services/shorts/sharePage.ts` points `og:image` at by default.
 *
 * Flags:
 *   --out=<path>   write the PNG somewhere else (preview without touching git)
 *   --svg          also write the SVG source next to the PNG
 *
 * FONTS. The card is drawn in Inter (headline) and Geist Mono (labels), the two
 * faces the Bridge design system uses. Neither ships with macOS, and sharp
 * rasterizes SVG through fontconfig, so an unprepared machine quietly falls back
 * to Helvetica/Menlo — legible, but not the brand. The committed PNG was
 * rendered with the real faces like this:
 *
 *   mkdir -p /tmp/ogfonts /tmp/ogfc
 *   # TTF URLs come from `curl "https://fonts.googleapis.com/css2?family=Inter:wght@600"`
 *   curl -o /tmp/ogfonts/Inter-Medium.ttf     <inter 500 ttf url>
 *   curl -o /tmp/ogfonts/Inter-SemiBold.ttf   <inter 600 ttf url>
 *   curl -o /tmp/ogfonts/GeistMono-Medium.ttf <geist mono 500 ttf url>
 *   cat > /tmp/ogfc/fonts.conf <<'XML'
 *   <?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
 *   <fontconfig>
 *     <dir>/tmp/ogfonts</dir>
 *     <dir>/System/Library/Fonts</dir>
 *     <cachedir>/tmp/ogfc/cache</cachedir>
 *   </fontconfig>
 *   XML
 *   FONTCONFIG_PATH=/tmp/ogfc npx tsx src/scripts/generateShortsOgCard.ts
 *
 * Without that, the script still emits a clean card — just in system type.
 *
 * The card is deliberately ROUND-AGNOSTIC — no challenge title, no date, no
 * builder name — because it is one static asset reused for every share link.
 * Anything time-bound here goes stale the moment the round rolls over.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/** Bridge design tokens (see CLAUDE.md "Bridge design system"). */
const INK = "#21201C";
const CREAM = "#FAF9F2";
const PAPER = "#FFFFFF";

// Single family names on purpose. librsvg/pango treats a CSS-style
// comma-separated stack as ONE family name, fails to match it, and silently
// drops to the default sans/mono — i.e. a fallback list here would GUARANTEE
// the brand faces are never used. With a bare name, fontconfig does the
// substituting itself when the face is missing, so an unprepared machine
// still gets clean system type rather than tofu.
const SANS = "Inter";
const MONO = "Geist Mono";

/** The card as SVG. Exported so it can be inspected or re-rasterized elsewhere. */
export function buildOgCardSvg(): string {
  const W = OG_CARD_WIDTH;
  const H = OG_CARD_HEIGHT;

  // Inset paper panel on the cream field.
  const panel = { x: 48, y: 48, w: W - 96, h: H - 96, r: 28 };
  // Content gutter inside the panel.
  const left = panel.x + 72;
  const right = panel.x + panel.w - 72;
  // Ink footer band, flush with the panel's bottom edge.
  const band = { y: panel.y + panel.h - 96, h: 96 };

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${CREAM}"/>`,
    // Paper panel with a hairline warm border.
    `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="${panel.r}" fill="${PAPER}" stroke="${INK}" stroke-opacity="0.14" stroke-width="2"/>`,

    // Eyebrow: ink mark + mono uppercase label.
    `<rect x="${left}" y="126" width="26" height="26" rx="7" fill="${INK}"/>`,
    `<text x="${left + 44}" y="147" font-family="${MONO}" font-size="20" font-weight="500" letter-spacing="3.2" fill="${INK}" fill-opacity="0.72">WEEKLY BUILD CHALLENGE</text>`,

    // Wordmark.
    `<text x="${left}" y="296" font-family="${SANS}" font-size="88" font-weight="600" letter-spacing="-3" fill="${INK}">Bridge Shorts</text>`,

    // Product line, split for rhythm.
    `<text x="${left}" y="370" font-family="${SANS}" font-size="38" font-weight="500" letter-spacing="-0.6" fill="${INK}" fill-opacity="0.64">One challenge. One week.</text>`,
    `<text x="${left}" y="422" font-family="${SANS}" font-size="38" font-weight="500" letter-spacing="-0.6" fill="${INK}" fill-opacity="0.64">Everyone gets the same model.</text>`,

    // Ink footer band: rounded rect, then a square-cornered patch over its top
    // half so only the panel's bottom corners stay round.
    `<rect x="${panel.x}" y="${band.y}" width="${panel.w}" height="${band.h}" rx="${panel.r}" fill="${INK}"/>`,
    `<rect x="${panel.x}" y="${band.y}" width="${panel.w}" height="${band.h / 2}" fill="${INK}"/>`,
    `<text x="${left}" y="${band.y + 58}" font-family="${MONO}" font-size="21" font-weight="500" letter-spacing="3" fill="${CREAM}">SHORTS.BRIDGE-JOBS.COM</text>`,
    `<text x="${right}" y="${band.y + 58}" text-anchor="end" font-family="${MONO}" font-size="21" font-weight="500" letter-spacing="3" fill="${CREAM}" fill-opacity="0.62">MADE BY BRIDGE</text>`,
    "</svg>",
  ].join("\n");
}

function defaultOutPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // server/src/scripts
  const repoRoot = path.resolve(here, "../../..");
  return path.join(repoRoot, "shorts/client/public/og/shorts-card.png");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  const outPath = outArg ? path.resolve(outArg) : defaultOutPath();
  const svg = buildOgCardSvg();

  await mkdir(path.dirname(outPath), { recursive: true });
  if (args.includes("--svg")) {
    const svgPath = outPath.replace(/\.png$/i, ".svg");
    await writeFile(svgPath, svg, "utf8");
    console.log(`[og-card] wrote ${svgPath}`);
  }

  // density 72 == 1 SVG user unit per pixel; the resize is a belt-and-braces
  // guarantee that the file is exactly 1200x630 whatever sharp's default is.
  const info = await sharp(Buffer.from(svg), { density: 72 })
    .resize(OG_CARD_WIDTH, OG_CARD_HEIGHT, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(
    `[og-card] wrote ${outPath} (${info.width}x${info.height}, ${info.size} bytes)`,
  );
  if (info.width !== OG_CARD_WIDTH || info.height !== OG_CARD_HEIGHT) {
    throw new Error(
      `[og-card] expected ${OG_CARD_WIDTH}x${OG_CARD_HEIGHT}, got ${info.width}x${info.height}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
