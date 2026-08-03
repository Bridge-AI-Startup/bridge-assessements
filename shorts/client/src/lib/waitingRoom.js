/**
 * Content for the "while you wait" card shown during a Claude build turn.
 *
 * A build turn is a single blocking call (serverless Messages, or `claude -p`
 * in E2B), so there is no token stream to show progress with — the wait reads
 * as dead air. This module supplies two things to fill it:
 *
 *  - BUILD_STATUS_LINES: plausible-sounding stage narration, rotated on a
 *    timer. It is *cosmetic* — we have no real progress signal — so the lines
 *    stay vague enough to never claim something false.
 *  - Bits: riddles, knock-knock jokes, one-liners, trivia and prompting tips,
 *    all in one shape so the card can render them with a single code path.
 *
 * Bit shape: `{ id, label, steps: [{ text, cta? }] }`. The card shows step 0
 * and, when that step carries a `cta`, a button labelled with it that reveals
 * the next step. A step without a `cta` ends the bit. That covers one-shot
 * trivia (one step), riddles (setup → answer) and knock-knocks (three steps)
 * without special-casing any of them.
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
  ["cache", "Cache.", "Cache who?", "No thanks, I prefer almonds."],
  ["nobel", "Nobel.", "Nobel who?", "No bell — that's why I knocked."],
  ["lettuce", "Lettuce.", "Lettuce who?", "Lettuce in, it's cold out here."],
  ["tank", "Tank.", "Tank who?", "You're welcome."],
  ["recursion", "Recursion.", "Recursion who?", "Knock knock."],
  ["olive", "Olive.", "Olive who?", "Olive you, and I'm not sorry."],
  ["hatch", "Hatch.", "Hatch who?", "Bless you."],
  ["semicolon", "Semicolon.", "Semicolon who?", "Never mind — JavaScript inserted one for me."],
  ["merge", "Merge.", "Merge who?", "Merge conflict. I'm afraid you'll have to resolve me."],
  ["deadline", "Deadline.", "Deadline who?", "Exactly. Nobody ever recognises it either."],
];

const ONE_LINERS = [
  ["darkmode", "Why do programmers prefer dark mode?", "Light attracts bugs."],
  ["binary", "There are 10 kinds of people in the world:", "Those who understand binary, and those who don't."],
  ["sqljoin", "A SQL query walks into a bar, approaches two tables and asks:", "\"Mind if I join you?\""],
  ["broke", "Why did the developer go broke?", "They used up all their cache."],
  ["lightbulb", "How many programmers does it take to change a light bulb?", "None. That's a hardware problem."],
  ["node", "Why was the JavaScript developer so sad?", "They didn't Node how to Express themselves."],
  ["foobar", "Where do programmers like to hang out?", "The Foo Bar."],
  ["udp", "I'd tell you a UDP joke,", "but you might not get it."],
  ["css", "Why did the CSS developer walk out of the restaurant?", "They didn't like the table layout."],
  ["detective", "Debugging:", "being the detective in a crime movie where you are also the murderer."],
  ["bread", "A programmer's partner says: \"Get a loaf of bread. If they have eggs, get a dozen.\"", "They came home with twelve loaves of bread."],
  ["array", "Why do array indexes start at zero?", "Because the first one is always a disappointment."],
  ["boolean", "I told a boolean joke once.", "It was either funny or it wasn't."],
  ["offbyone", "There are two hard things in computer science: cache invalidation, naming things,", "and off-by-one errors."],
];

const TRIVIA = [
  ["moth", "The first computer bug was a literal moth — taped into a Harvard logbook in 1947."],
  ["atsign", "The @ in email was chosen in 1971 mostly because it was the least-used key on the keyboard."],
  ["helloworld", "\"Hello, world\" comes from a 1972 Bell Labs tutorial written by Brian Kernighan."],
  ["nintendo", "Nintendo was founded in 1889 — it made playing cards for most of a century."],
  ["coffeepot", "The world's first webcam existed to watch a coffee pot in a Cambridge lab, so nobody walked to an empty jug."],
  ["qwerty", "The QWERTY layout is from the 1870s. Your keyboard is older than powered flight."],
  ["jiffy", "A \"jiffy\" is a real unit of time — in some systems, 1/60th of a second."],
  ["firstsite", "The first website is still online, and it is one page of plain links."],
  ["mouse", "The first computer mouse, built in 1964, was a block of wood with two wheels."],
  ["ada", "Ada Lovelace published the first algorithm intended for a machine in 1843 — a century before the machine existed."],
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

/** @typedef {{ id: string, label: string, steps: { text: string, cta?: string }[] }} WaitBit */

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
];

/**
 * Pick a bit at random, never repeating the one currently on screen.
 * @param {string | null} previousId
 * @returns {WaitBit}
 */
export function nextWaitBit(previousId = null) {
  const pool =
    previousId == null
      ? WAIT_BITS
      : WAIT_BITS.filter((bit) => bit.id !== previousId);
  const choices = pool.length > 0 ? pool : WAIT_BITS;
  return choices[Math.floor(Math.random() * choices.length)];
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
