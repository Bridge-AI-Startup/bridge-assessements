import { useEffect, useRef, useState } from "react";

/**
 * Minigames for the build wait card. Each is a self-contained component that
 * lives entirely inside the card: no routing, no persistence, no layout
 * escape — when the build finishes and the card unmounts, the game goes with
 * it, which is the point (the game is the wait, not a destination).
 *
 * Keep every game touch-first and legible at ~300px wide: the card renders in
 * the chat column on mobile. New game = add a component here + register it in
 * WAIT_GAMES and in `lib/waitingRoom.js` GAMES.
 */

/* ------------------------------------------------------------------ */
/* Reaction test: wait for green, tap as fast as you can.              */
/* ------------------------------------------------------------------ */

function ReactionGame() {
  const [phase, setPhase] = useState("idle"); // idle | armed | go | early | done
  const [ms, setMs] = useState(null);
  const [best, setBest] = useState(null);
  const goAtRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function arm() {
    setPhase("armed");
    setMs(null);
    timerRef.current = setTimeout(
      () => {
        goAtRef.current = Date.now();
        setPhase("go");
      },
      1200 + Math.random() * 2300,
    );
  }

  function handleTap() {
    if (phase === "idle" || phase === "early" || phase === "done") {
      arm();
      return;
    }
    if (phase === "armed") {
      clearTimeout(timerRef.current);
      setPhase("early");
      return;
    }
    // phase === "go"
    const t = Date.now() - goAtRef.current;
    setMs(t);
    setBest((b) => (b == null || t < b ? t : b));
    setPhase("done");
  }

  const face =
    phase === "idle"
      ? { text: "Tap to start", cls: "bg-mist text-fog" }
      : phase === "armed"
        ? { text: "Wait for green…", cls: "bg-accent-amber/20 text-ink" }
        : phase === "go"
          ? { text: "TAP!", cls: "bg-accent-emerald text-white" }
          : phase === "early"
            ? { text: "Too soon! Tap to retry", cls: "bg-mist text-fog" }
            : { text: `${ms} ms — tap to go again`, cls: "bg-mist text-ink" };

  return (
    <div>
      <button
        type="button"
        onClick={handleTap}
        className={`flex h-24 w-full select-none items-center justify-center rounded-xl text-sm font-medium transition-colors ${face.cls}`}
      >
        {face.text}
      </button>
      <p className="mt-2 text-xs text-fog-light">
        {best != null ? `Best this wait: ${best} ms` : "How fast are you?"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Odd one out: one tile is a different shade — tap it.                */
/* ------------------------------------------------------------------ */

const SHADE_GRID = 4; // 4×4

function newShadeRound(streak) {
  // Shrink the difference as the streak grows; floor keeps it winnable.
  const delta = Math.max(4, 14 - streak * 2);
  const hue = Math.floor(Math.random() * 360);
  const light = 45 + Math.random() * 20;
  return {
    hue,
    light,
    delta,
    odd: Math.floor(Math.random() * SHADE_GRID * SHADE_GRID),
  };
}

function ShadeGame() {
  const [streak, setStreak] = useState(0);
  const [round, setRound] = useState(() => newShadeRound(0));
  const [missed, setMissed] = useState(false);

  function pick(index) {
    if (index === round.odd) {
      const next = streak + 1;
      setStreak(next);
      setMissed(false);
      setRound(newShadeRound(next));
    } else {
      setStreak(0);
      setMissed(true);
      setRound(newShadeRound(0));
    }
  }

  const base = `hsl(${round.hue}, 55%, ${round.light}%)`;
  const odd = `hsl(${round.hue}, 55%, ${round.light + round.delta}%)`;

  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: SHADE_GRID * SHADE_GRID }, (_, i) => (
          <button
            key={`${streak}-${round.odd}-${i}`}
            type="button"
            aria-label={`Tile ${i + 1}`}
            onClick={() => pick(i)}
            className="aspect-square rounded-lg transition-transform active:scale-95"
            style={{ backgroundColor: i === round.odd ? odd : base }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-fog-light" aria-live="polite">
        {missed
          ? "Missed — new round."
          : streak > 0
            ? `Streak: ${streak} — it gets harder.`
            : "One tile is a different shade. Tap it."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rock paper scissors vs. the card.                                   */
/* ------------------------------------------------------------------ */

const RPS = [
  { id: "rock", emoji: "🪨", beats: "scissors" },
  { id: "paper", emoji: "📄", beats: "rock" },
  { id: "scissors", emoji: "✂️", beats: "paper" },
];

function RpsGame() {
  const [last, setLast] = useState(null); // { you, them, outcome }
  const [score, setScore] = useState({ win: 0, lose: 0, draw: 0 });

  function play(you) {
    const them = RPS[Math.floor(Math.random() * RPS.length)];
    const outcome =
      you.id === them.id ? "draw" : you.beats === them.id ? "win" : "lose";
    setLast({ you, them, outcome });
    setScore((s) => ({ ...s, [outcome]: s[outcome] + 1 }));
  }

  const verdict =
    last == null
      ? "Pick one."
      : last.outcome === "draw"
        ? `${last.them.emoji} Draw.`
        : last.outcome === "win"
          ? `${last.them.emoji} You win!`
          : `${last.them.emoji} Card wins.`;

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {RPS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-label={option.id}
            onClick={() => play(option)}
            className={`rounded-xl border py-3 text-2xl transition-transform active:scale-95 ${
              last?.you.id === option.id
                ? "border-ink bg-mist"
                : "border-line bg-paper"
            }`}
          >
            {option.emoji}
          </button>
        ))}
      </div>
      <p className="mt-2 flex items-baseline justify-between text-xs">
        <span className="text-ink" aria-live="polite">
          {verdict}
        </span>
        <span className="font-mono tabular-nums text-fog-light">
          {score.win}W · {score.lose}L · {score.draw}D
        </span>
      </p>
    </div>
  );
}

/** Registry keyed by the `game` field of a game bit in `lib/waitingRoom.js`. */
export const WAIT_GAMES = {
  reaction: ReactionGame,
  shade: ShadeGame,
  rps: RpsGame,
};
