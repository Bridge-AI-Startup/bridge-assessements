/**
 * Instagram story card for a build — a 1080×1920 PNG drawn on a canvas in the
 * browser. Instagram has no web share URL, so "share to Instagram" means
 * handing the person an image (native share sheet where files are supported,
 * a download otherwise) and putting the build link on their clipboard for the
 * link sticker.
 *
 * The card is typographic on purpose: the build itself renders in a
 * cross-origin iframe (the API host serves previews) and cannot be rasterised
 * from here. It borrows the site's punch language instead — the SHORTS
 * sticker tiles, a tilted ink-bordered card with a hard shadow, and an ink
 * pill with the amber offset shadow.
 *
 * Instagram overlays roughly the top and bottom 250px of a story with its own
 * UI, so everything that matters sits between y≈300 and y≈1650.
 */

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

const INK = "#21201C";
const PAPER = "#FFFFFF";
const CREAM = "#FAFAF8";
const FOG = "#6F6D66";
const AMBER = "#F59E0B";
const TILE_COLORS = ["#F59E0B", "#8B5CF6", "#3B82F6", "#10B981"];
const TILE_TILTS = [-3, 2, -2, 3, -1, 2];

const SANS = "Inter, system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";

const SAFE_X = 96;
const CARD_W = STORY_WIDTH - SAFE_X * 2;

async function loadFonts() {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.all(
      [`600 100px ${SANS}`, `500 40px ${SANS}`, `500 30px ${MONO}`].map((f) =>
        document.fonts.load(f),
      ),
    );
  } catch {
    // Fall back to whatever the canvas resolves — still a usable card.
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Word-wrap `text` to `maxWidth`, breaking over-long words by character. */
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    push();
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    // A single token wider than the card (long names with no spaces).
    let chunk = "";
    for (const ch of word) {
      if (ctx.measureText(chunk + ch).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  push();
  return lines;
}

/** Largest font size (between min and max) at which the text fits `maxLines`. */
function fitLines(ctx, text, maxWidth, { max, min, maxLines, weight, family }) {
  for (let size = max; size >= min; size -= 4) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  const lines = wrapLines(ctx, text, maxWidth).slice(0, maxLines);
  const last = lines[maxLines - 1];
  if (last) lines[maxLines - 1] = `${last.replace(/[\s.]+$/, "")}…`;
  return { size: min, lines };
}

function drawTiles(ctx, word, centerX, centerY, size, gap) {
  const letters = word.split("");
  const total = letters.length * size + (letters.length - 1) * gap;
  let x = centerX - total / 2 + size / 2;
  letters.forEach((letter, i) => {
    ctx.save();
    ctx.translate(x, centerY);
    ctx.rotate((TILE_TILTS[i % TILE_TILTS.length] * Math.PI) / 180);
    // hard shadow, then tile, then border
    ctx.fillStyle = INK;
    roundRect(ctx, -size / 2 + 9, -size / 2 + 9, size, size, 20);
    ctx.fill();
    ctx.fillStyle = PAPER;
    roundRect(ctx, -size / 2, -size / 2, size, size, 20);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = TILE_COLORS[i % TILE_COLORS.length];
    ctx.font = `600 ${Math.round(size * 0.58)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, 0, 4);
    ctx.restore();
    x += size + gap;
  });
}

/** Ink pill with the site's amber hard shadow; returns its width. */
function drawPill(ctx, text, centerX, centerY, { font, padX, height, shadow }) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const x = centerX - w / 2;
  const y = centerY - height / 2;
  ctx.fillStyle = AMBER;
  roundRect(ctx, x + shadow, y + shadow, w, height, height / 2);
  ctx.fill();
  ctx.fillStyle = INK;
  roundRect(ctx, x, y, w, height, height / 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.fillText(text, centerX, centerY + 2);
  return w;
}

/**
 * Draw the card and resolve to a PNG Blob.
 *
 * @param {object} p
 * @param {string} p.displayName   the build's name
 * @param {string} [p.challengeTitle] the round's title (eyebrow on the card)
 * @param {number} [p.rank]        current rank in the round, if known
 * @param {string} p.host          where to vote, e.g. "shorts.bridge-jobs.com"
 */
export async function renderStoryCard({ displayName, challengeTitle, rank, host }) {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // Faint dot grid so the field reads as a table, not a blank sheet.
  ctx.fillStyle = "rgba(33,32,28,0.07)";
  for (let y = 60; y < STORY_HEIGHT; y += 60) {
    for (let x = 60; x < STORY_WIDTH; x += 60) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawTiles(ctx, "SHORTS", STORY_WIDTH / 2, 440, 124, 18);

  ctx.fillStyle = FOG;
  ctx.font = `500 26px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("B R I D G E   S H O R T S", STORY_WIDTH / 2, 574);

  // ---- the card -----------------------------------------------------------
  const pad = 72;
  const innerW = CARD_W - pad * 2;

  ctx.font = `500 28px ${MONO}`;
  const eyebrow = challengeTitle
    ? wrapLines(ctx, challengeTitle.toUpperCase(), innerW).slice(0, 2)
    : ["THIS ROUND'S BUILD"];
  const eyebrowLH = 38;

  const name = fitLines(ctx, displayName || "untitled build", innerW, {
    max: 116,
    min: 60,
    maxLines: 3,
    weight: 600,
    family: SANS,
  });
  const nameLH = Math.round(name.size * 1.06);

  const pillH = 76;
  const cardH =
    pad +
    eyebrow.length * eyebrowLH +
    30 +
    name.lines.length * nameLH +
    48 +
    pillH +
    pad;
  const cardX = SAFE_X;
  const cardY = 680;
  const cx = cardX + CARD_W / 2;
  const cy = cardY + cardH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-1.6 * Math.PI) / 180);
  const left = -CARD_W / 2;
  const top = -cardH / 2;
  ctx.fillStyle = INK;
  roundRect(ctx, left + 16, top + 16, CARD_W, cardH, 40);
  ctx.fill();
  ctx.fillStyle = PAPER;
  roundRect(ctx, left, top, CARD_W, cardH, 40);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();

  let y = top + pad;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = FOG;
  ctx.font = `500 28px ${MONO}`;
  for (const line of eyebrow) {
    y += eyebrowLH;
    ctx.fillText(line, left + pad, y - 10);
  }
  y += 30;
  ctx.fillStyle = INK;
  ctx.font = `600 ${name.size}px ${SANS}`;
  for (const line of name.lines) {
    y += nameLH;
    ctx.fillText(line, left + pad - 4, y - Math.round(name.size * 0.22));
  }
  y += 48;
  const pillText =
    rank != null && Number.isFinite(rank)
      ? `#${rank} THIS ROUND`
      : "JUST SUBMITTED";
  ctx.font = `500 28px ${MONO}`;
  const pillW = Math.ceil(ctx.measureText(pillText).width) + 72;
  const pillX = left + pad;
  const pillY = y;
  ctx.fillStyle = AMBER;
  roundRect(ctx, pillX + 7, pillY + 7, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = INK;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, pillX + pillW / 2, pillY + pillH / 2 + 2);
  ctx.restore();

  // ---- call to action -----------------------------------------------------
  const ctaY = cardY + cardH + 170;
  ctx.fillStyle = FOG;
  ctx.font = `500 38px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Pick the one you'd rather keep open at", STORY_WIDTH / 2, ctaY);
  drawPill(ctx, String(host || "").toUpperCase(), STORY_WIDTH / 2, ctaY + 86, {
    font: `500 34px ${MONO}`,
    padX: 52,
    height: 96,
    shadow: 10,
  });

  // The product line, so the card argues for the game and not just the build.
  ctx.fillStyle = FOG;
  ctx.font = `500 34px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const tagline = wrapLines(
    ctx,
    "Everyone gets the same challenge and the same model. The difference is you.",
    CARD_W - 80,
  );
  // Sits above the footer band; skipped when a three-line name has already
  // pushed the call to action down into that space.
  let ty = Math.max(ctaY + 260, STORY_HEIGHT - 200 - 120 - tagline.length * 46);
  if (ty + tagline.length * 46 <= STORY_HEIGHT - 200 - 56) {
    for (const line of tagline) {
      ctx.fillText(line, STORY_WIDTH / 2, ty);
      ty += 46;
    }
  }

  // Ink footer band. Its text sits inside Instagram's bottom overlay zone,
  // so it is decoration; nothing load-bearing lives down here.
  ctx.fillStyle = INK;
  ctx.fillRect(0, STORY_HEIGHT - 200, STORY_WIDTH, 200);
  ctx.fillStyle = CREAM;
  ctx.font = `500 26px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText("B R I D G E  S H O R T S", SAFE_X, STORY_HEIGHT - 86);
  ctx.textAlign = "right";
  ctx.globalAlpha = 0.65;
  ctx.fillText("M A D E  B Y  B R I D G E", STORY_WIDTH - SAFE_X, STORY_HEIGHT - 86);
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("story_card_blob_failed"));
    }, "image/png");
  });
}

/** `<slug>-story.png`, mirroring the download button's naming. */
export function storyCardFilename(displayName) {
  const slug =
    String(displayName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shorts-build";
  return `${slug}-story.png`;
}
