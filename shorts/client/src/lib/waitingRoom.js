/**
 * Content for the "while you wait" card shown during a Claude build turn.
 *
 * A build turn is a single blocking call (serverless Messages, or `claude -p`
 * in E2B), so there is no token stream to show progress with — the wait reads
 * as dead air. This module supplies the filler:
 *
 *  - BUILD_STATUS_LINES: plausible-sounding stage narration, rotated on a
 *    timer. It is *cosmetic* — we have no real progress signal — so the lines
 *    stay vague enough to never claim something false.
 *  - Bits: riddles, knock-knock jokes, one-liners, trivia, prompting tips and
 *    minigames. Shorts is for everyone, so the humor is deliberately
 *    general-audience — no jokes that need programming knowledge to land.
 *
 * Text bit shape: `{ id, label, steps: [{ text, cta? }] }`. The card shows
 * step 0 and, when that step carries a `cta`, a button labelled with it that
 * reveals the next step. A step without a `cta` ends the bit. That covers
 * one-shot trivia (one step), riddles (setup → answer) and knock-knocks
 * (three steps) without special-casing any of them.
 *
 * Game bit shape: `{ id, label, kind: "game", game }` — `game` names a
 * component in `components/workspace/waitGames.jsx`. Games are tiny,
 * touch-first, and confined to the card; `nextWaitBit` deals one in
 * GAME_PROBABILITY of draws so they stay a treat rather than the default.
 */

export const BUILD_STATUS_LINES = [
  "Reading your prompt…",
  "Sketching the layout…",
  "Picking colors…",
  "Writing the markup…",
  "Wiring up the logic…",
  "Tightening the spacing…",
  "Still going — good ones take a minute…",
];

/** Seconds of wait per status line before advancing to the next. */
export const STATUS_LINE_INTERVAL_SECONDS = 6;

const RIDDLES = [
  ["keyboard", "I have keys but open no locks. I have space but no room. You can enter, but you can't get in.", "A keyboard."],
  ["egg", "What has to be broken before you can use it?", "An egg."],
  ["candle", "I'm tall when I'm young and short when I'm old.", "A candle."],
  ["towel", "What gets wetter the more it dries?", "A towel."],
  ["footsteps", "The more of me you take, the more you leave behind.", "Footsteps."],
  ["comb", "What has many teeth but cannot bite?", "A comb."],
  ["stamp", "What can travel all the way around the world while staying in one corner?", "A stamp."],
  ["echo", "I speak without a mouth and hear without ears. I have no body, but I come alive with wind.", "An echo."],
  ["needle", "What has one eye but cannot see?", "A needle."],
  ["coin", "What has a head and a tail but no body?", "A coin."],
  ["map", "I have cities but no houses, forests but no trees, and water but no fish.", "A map."],
  ["shadow", "What follows you everywhere but disappears the moment you stand in the dark?", "Your shadow."],
  ["future", "What is always coming but never arrives?", "Tomorrow."],
  ["silence", "What breaks the moment you say its name?", "Silence."],
];

const KNOCK_KNOCKS = [
  ["boo", "Boo.", "Boo who?", "Don't cry — it's still building."],
  ["cow", "Interrupting cow.", "Interrupting cow wh—", "MOO."],
  ["nobel", "Nobel.", "Nobel who?", "No bell — that's why I knocked."],
  ["lettuce", "Lettuce.", "Lettuce who?", "Lettuce in, it's cold out here."],
  ["tank", "Tank.", "Tank who?", "You're welcome."],
  ["olive", "Olive.", "Olive who?", "Olive you, and I'm not sorry."],
  ["hatch", "Hatch.", "Hatch who?", "Bless you."],
  ["harry", "Harry.", "Harry who?", "Harry up, this build's almost done."],
  ["annie", "Annie.", "Annie who?", "Annie body seen my build? It was just here."],
  ["canoe", "Canoe.", "Canoe who?", "Canoe guess what it's making in there?"],
  ["justin", "Justin.", "Justin who?", "Justin time for the big reveal."],
  ["donut", "Donut.", "Donut who?", "Donut peek — it's not finished yet."],
];

const ONE_LINERS = [
  ["atoms", "Why don't scientists trust atoms?", "Because they make up everything."],
  ["scarecrow", "Why did the scarecrow win an award?", "He was outstanding in his field."],
  ["fsh", "What do you call a fish with no eyes?", "A fsh."],
  ["twotired", "Why did the bicycle fall over?", "It was two-tired."],
  ["nacho", "What do you call cheese that isn't yours?", "Nacho cheese."],
  ["astronaut", "Why did the astronaut break up with their partner?", "They needed space."],
  ["carrot", "What's orange and sounds like a parrot?", "A carrot."],
  ["grape", "What did the grape do when it got stepped on?", "It let out a little wine."],
  ["skeleton", "Why don't skeletons ever fight?", "They don't have the guts."],
  ["mathbook", "Why was the math book sad?", "It had too many problems."],
  ["banker", "I used to work at a bank,", "but I lost interest."],
  ["golfer", "Why do golfers carry a spare pair of trousers?", "In case they get a hole in one."],
  ["elevator", "I tried to start an elevator business.", "It had its ups and downs."],
  ["seagull", "Why do seagulls fly over the sea?", "Because if they flew over the bay, they'd be bagels."],
  ["clock", "Why did the clock get kicked out of the library?", "It tocked too much."],
  ["pony", "Why couldn't the pony sing?", "It was a little horse."],
];

const TRIVIA = [
  ["honey", "Honey never spoils — pots found in ancient Egyptian tombs are still perfectly edible."],
  ["octopus", "An octopus has three hearts, nine brains, and blue blood."],
  ["flamingo", "A group of flamingos is called a flamboyance."],
  ["banana", "Botanically, bananas are berries — and strawberries aren't."],
  ["eiffel", "The Eiffel Tower grows about 15 cm taller every summer as the metal expands."],
  ["venus", "A day on Venus is longer than its year."],
  ["sharks", "Sharks are older than trees — by about 50 million years."],
  ["unicorn", "Scotland's official national animal is the unicorn."],
  ["wombat", "Wombats are the only animal whose poop is cube-shaped."],
  ["nintendo", "Nintendo was founded in 1889 — it made playing cards for most of a century."],
  ["qwerty", "The QWERTY layout is from the 1870s. Your keyboard is older than powered flight."],
  ["coffeepot", "The world's first webcam existed to watch a coffee pot, so nobody walked to an empty jug."],
  ["oxford", "Oxford University is older than the Aztec Empire."],
  ["clouds", "An average cumulus cloud weighs about as much as 80 elephants."],
];

const TIPS = [
  ["onechange", "Ask for one change at a time. Small, specific prompts land far more reliably than one giant spec."],
  ["feel", "Describe the feeling, not just the feature. \"Calm, slow fade\" gets you further than \"add an animation\"."],
  ["describe", "If something looks wrong, describe exactly what you see — Claude can't look at your screen."],
  ["explicit", "Name the colors, sizes and fonts you care about. Anything you leave open gets decided for you."],
  ["surprise", "Stuck? Ask \"what would make this more surprising?\" before you ask for more code."],
  ["voters", "Voters see your build next to someone else's. The safe, generic version is the one that loses."],
  ["keepbest", "Happy with it? Stop prompting. Every extra turn is tokens you can't get back."],
];

/**
 * Minigames — rendered by `waitGames.jsx`, one entry per component there.
 * Listed here so the same draw handles a joke and a game.
 */
const GAMES = [
  ["reaction", "Reaction test"],
  ["shade", "Odd one out"],
  ["rps", "Rock paper scissors"],
  ["higherlower", "Higher or lower"],
];

/** Fraction of draws that deal a minigame instead of a text bit. */
const GAME_PROBABILITY = 0.3;

/**
 * @typedef {{ id: string, label: string, steps: { text: string, cta?: string }[] }} WaitTextBit
 * @typedef {{ id: string, label: string, kind: "game", game: string }} WaitGameBit
 * @typedef {WaitTextBit | WaitGameBit} WaitBit
 */

/** @type {WaitBit[]} */
export const WAIT_BITS = [
  ...RIDDLES.map(([id, setup, answer]) => ({
    id: `riddle-${id}`,
    label: "Riddle",
    steps: [{ text: setup, cta: "Reveal answer" }, { text: answer }],
  })),
  ...KNOCK_KNOCKS.map(([id, who, whoWho, punchline]) => ({
    id: `knock-${id}`,
    label: "Knock knock",
    steps: [
      { text: "Knock knock.", cta: "Who's there?" },
      { text: who, cta: whoWho },
      { text: punchline },
    ],
  })),
  ...ONE_LINERS.map(([id, setup, punchline]) => ({
    id: `joke-${id}`,
    label: "Joke",
    steps: [{ text: setup, cta: "Punchline" }, { text: punchline }],
  })),
  ...TRIVIA.map(([id, fact]) => ({
    id: `trivia-${id}`,
    label: "Did you know",
    steps: [{ text: fact }],
  })),
  ...TIPS.map(([id, tip]) => ({
    id: `tip-${id}`,
    label: "Prompting tip",
    steps: [{ text: tip }],
  })),
  ...GAMES.map(([game, label]) => ({
    id: `game-${game}`,
    label,
    kind: "game",
    game,
  })),
];

/**
 * Pick a bit at random, never repeating the one currently on screen.
 * Games are dealt at a fixed rate rather than by pool share, so adding more
 * jokes never quietly starves them out.
 * @param {string | null} previousId
 * @returns {WaitBit}
 */
export function nextWaitBit(previousId = null) {
  const games = WAIT_BITS.filter(
    (bit) => bit.kind === "game" && bit.id !== previousId,
  );
  const texts = WAIT_BITS.filter(
    (bit) => bit.kind !== "game" && bit.id !== previousId,
  );
  const pool =
    games.length > 0 && Math.random() < GAME_PROBABILITY
      ? games
      : texts.length > 0
        ? texts
        : WAIT_BITS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Status line for a given elapsed wait, holding on the last line thereafter.
 * @param {number} elapsedSeconds
 */
export function statusLineFor(elapsedSeconds) {
  const index = Math.floor(elapsedSeconds / STATUS_LINE_INTERVAL_SECONDS);
  return BUILD_STATUS_LINES[Math.min(index, BUILD_STATUS_LINES.length - 1)];
}

/**
 * mm:ss for the elapsed meter.
 * @param {number} totalSeconds
 */
export function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
