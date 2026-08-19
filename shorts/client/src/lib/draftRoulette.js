/**
 * Random first-draft "roulette" for an empty Shorts build.
 *
 * Three independent banks — vibe, material, twist — so a spin is a
 * combinatorial gag, not a canned prompt. The resulting chat line is a
 * BUILD instruction: make a real working draft of this week's challenge,
 * just through that lens.
 *
 * Humor is general-audience (same rule as waitingRoom.js): no jokes that
 * need programming knowledge to land.
 */

export const REEL_VIBES = [
  "90s shareware",
  "a luxury perfume ad",
  "a 1974 government form",
  "a Saturday-morning cartoon",
  "a convenience-store receipt",
  "a game show",
  "a school yearbook",
  "a tourist postcard",
  "a late-night infomercial",
  "a diner placemat",
  "a museum wall label",
  "a cereal box",
];

export const REEL_MATERIALS = [
  "Comic Sans and chunky bevels",
  "manila folders and rubber stamps",
  "velvet and gold foil",
  "LED tickers",
  "crayon on construction paper",
  "receipt-printer type",
  "felt and googly eyes",
  "neon motel signage",
  "newspaper classifieds",
  "fridge magnets",
  "stickers on a laptop lid",
  "chalk on a sidewalk",
];

export const REEL_TWISTS = [
  "everything slightly too small",
  "a raccoon is in charge",
  "only one giant button",
  "it takes itself extremely seriously",
  "the UI keeps complimenting you",
  "it rains glitter",
  "a tiny mascot runs the show",
  "every action needs a stamp",
  "time moves in slow motion",
  "it only uses three colours",
  "the help text is a poem",
  "it thinks it's a radio play",
];

export const REEL_BANKS = [REEL_VIBES, REEL_MATERIALS, REEL_TWISTS];

export function pickReelItem(bank, avoid) {
  if (!bank.length) return "";
  if (bank.length === 1) return bank[0];
  let next = bank[Math.floor(Math.random() * bank.length)];
  let guard = 0;
  while (next === avoid && guard < 8) {
    next = bank[Math.floor(Math.random() * bank.length)];
    guard += 1;
  }
  return next;
}

export function pickSpin(avoid = []) {
  const vibe = pickReelItem(REEL_VIBES, avoid[0]);
  const material = pickReelItem(REEL_MATERIALS, avoid[1]);
  const twist = pickReelItem(REEL_TWISTS, avoid[2]);
  return { vibe, material, twist };
}

/** Chat line sent as the user turn — short enough to read as a bubble. */
export function buildSpinPrompt({ vibe, material, twist }) {
  return (
    `Spin a first draft: ${vibe} · ${material} · ${twist}. ` +
    `Build this week's challenge that way — actually working, just weird. ` +
    `Don't ask me what I want; just go.`
  );
}
