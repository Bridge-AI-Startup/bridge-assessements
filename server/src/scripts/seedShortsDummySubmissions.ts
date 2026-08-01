/**
 * Seed dummy PlaySubmissions for testing gallery / vote / leaderboard.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/seedShortsDummySubmissions.ts
 *   npx tsx src/scripts/seedShortsDummySubmissions.ts --count=15
 *   npx tsx src/scripts/seedShortsDummySubmissions.ts --date=2026-07-14
 *   npx tsx src/scripts/seedShortsDummySubmissions.ts --clear   # delete prior dummy-* rows for that date first
 */

import "../config/loadEnv.js";
import { Types } from "mongoose";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";
import { getUtcChallengeDate } from "../services/shorts/challenges.js";
import {
  INITIAL_RANKING_SCORE,
  INITIAL_RATING_DEVIATION,
  INITIAL_RATING_MEAN,
} from "../services/shorts/ratingConstants.js";

const NAMES = [
  "Ava",
  "Ben",
  "Chris",
  "Dana",
  "Eli",
  "Faye",
  "Gus",
  "Harper",
  "Ivy",
  "Jules",
  "Kai",
  "Lina",
  "Mo",
  "Nina",
  "Omar",
  "Pia",
  "Quinn",
  "Rae",
  "Sam",
  "Teo",
  "Uma",
  "Vic",
  "Wes",
  "Xan",
  "Yuri",
];

const ACCENTS = [
  { bg: "#0f172a", accent: "#38bdf8", label: "Midnight" },
  { bg: "#14532d", accent: "#86efac", label: "Forest" },
  { bg: "#4c1d95", accent: "#c4b5fd", label: "Violet" },
  { bg: "#7c2d12", accent: "#fdba74", label: "Ember" },
  { bg: "#164e63", accent: "#67e8f9", label: "Tide" },
  { bg: "#831843", accent: "#f9a8d4", label: "Rose" },
  { bg: "#1e3a8a", accent: "#93c5fd", label: "Sky" },
  { bg: "#365314", accent: "#bef264", label: "Lime" },
];

function parseArgs(argv: string[]) {
  let count = 12;
  let challengeDate = getUtcChallengeDate();
  let clear = false;
  for (const arg of argv) {
    if (arg === "--clear") clear = true;
    else if (arg.startsWith("--count=")) {
      count = Math.min(Math.max(parseInt(arg.slice(8), 10) || 12, 1), 25);
    } else if (arg.startsWith("--date=")) {
      challengeDate = arg.slice(7);
    }
  }
  return { count, challengeDate, clear };
}

function buildFiles(index: number, name: string) {
  const accent = ACCENTS[index % ACCENTS.length];
  const start = (index * 3) % 17;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}'s Todo</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>${name}'s Todos</h1>
    <p class="tag">${accent.label} theme · #${index + 1}</p>
    <form id="form">
      <input id="input" placeholder="Add a todo…" autocomplete="off" />
      <button type="submit">Add</button>
    </form>
    <ul id="list"></ul>
  </main>
  <script src="main.js"></script>
</body>
</html>
`;

  const css = `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: ${accent.bg};
  color: #f8fafc;
  display: grid;
  place-items: center;
  padding: 24px;
}
main {
  width: min(420px, 100%);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px;
  padding: 20px;
}
h1 { margin: 0 0 4px; font-size: 1.4rem; }
.tag { margin: 0 0 16px; color: ${accent.accent}; font-size: 0.8rem; }
form { display: flex; gap: 8px; margin-bottom: 16px; }
input {
  flex: 1;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(0,0,0,0.25);
  color: #fff;
  border-radius: 8px;
  padding: 10px 12px;
}
button {
  border: none;
  background: ${accent.accent};
  color: #0f172a;
  font-weight: 700;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}
ul { list-style: none; padding: 0; margin: 0; }
li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
li.done span { text-decoration: line-through; opacity: 0.55; }
li button {
  margin-left: auto;
  background: transparent;
  color: #fda4af;
  padding: 4px 8px;
}
`;

  const js = `const KEY = "play-dummy-todos-${index}";
const form = document.getElementById("form");
const input = document.getElementById("input");
const list = document.getElementById("list");
let todos = [];
try { todos = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { todos = []; }
if (!todos.length) {
  todos = [
    { id: 1, text: "Ship something small", done: false },
    { id: 2, text: "Vote on 5 builds", done: ${index % 2 === 0} },
    { id: 3, text: "Start count ${start}", done: false },
  ];
}
function save() { localStorage.setItem(KEY, JSON.stringify(todos)); }
function render() {
  list.innerHTML = "";
  todos.forEach((t) => {
    const li = document.createElement("li");
    if (t.done) li.classList.add("done");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = t.done;
    box.addEventListener("change", () => {
      t.done = box.checked;
      save();
      render();
    });
    const span = document.createElement("span");
    span.textContent = t.text;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      todos = todos.filter((x) => x.id !== t.id);
      save();
      render();
    });
    li.append(box, span, del);
    list.appendChild(li);
  });
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  todos.push({ id: Date.now(), text, done: false });
  input.value = "";
  save();
  render();
});
render();
`;

  return [
    { path: "index.html", content: html },
    { path: "style.css", content: css },
    { path: "main.js", content: js },
    {
      path: "README.md",
      content: `# ${name}'s Play submission\n\nDummy seed #${index + 1}. Preview = index.html.\n`,
    },
  ];
}

async function main() {
  const { count, challengeDate, clear } = parseArgs(process.argv.slice(2));
  await connectPlayMongoose();
  const Submission = getPlaySubmissionModel();

  if (clear) {
    const deleted = await Submission.deleteMany({
      challengeDate,
      anonymousId: { $regex: /^dummy-/ },
    });
    console.log(
      `Cleared ${deleted.deletedCount} dummy submissions for ${challengeDate}`,
    );
  }

  // Prefer today's published challenge slug if present.
  let challengeSlug = "todo-list";
  try {
    const { getTodayChallenge } = await import(
      "../services/shorts/challenges.js"
    );
    const today = await getTodayChallenge();
    if (today?.slug) challengeSlug = today.slug;
  } catch {
    /* keep default */
  }

  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = NAMES[i % NAMES.length];
    const anonymousId = `dummy-${String(i + 1).padStart(2, "0")}-${challengeDate}`;
    const files = buildFiles(i, name);
    const totalBytes = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0,
    );

    const doc = await Submission.findOneAndUpdate(
      { anonymousId, challengeDate },
      {
        $set: {
          anonymousId,
          displayName: name,
          challengeSlug,
          challengeDate,
          sessionId: new Types.ObjectId(),
          files,
          fileCount: files.length,
          totalBytes,
          submittedAt: new Date(Date.now() - (count - i) * 60_000),
          ratingMean: INITIAL_RATING_MEAN,
          ratingDeviation: INITIAL_RATING_DEVIATION,
          rankingScore: INITIAL_RANKING_SCORE,
          wins: 0,
          losses: 0,
          matches: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    created.push(`${doc.displayName} (${doc._id})`);
  }

  console.log(
    `Seeded ${created.length} dummy submissions for ${challengeDate} (slug=${challengeSlug}):`,
  );
  for (const line of created) console.log("  -", line);
  console.log("\nOpen /Gallery or /Vote on the Play client to try them.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
