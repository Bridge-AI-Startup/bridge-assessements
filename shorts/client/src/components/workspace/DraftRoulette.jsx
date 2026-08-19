import { useEffect, useRef, useState } from "react";
import {
  REEL_BANKS,
  buildSpinPrompt,
  pickReelItem,
  pickSpin,
} from "@/lib/draftRoulette";

const ACCENTS = [
  "text-accent-amber",
  "text-accent-violet",
  "text-accent-blue",
];

const IDLE_MS = 2800;
const WHIR_MS = 70;
const STOP_AT = [1400, 1780, 2160];

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hintCopy(chatHint) {
  if (chatHint === "left") return "Type it on the left.";
  if (chatHint === "below") return "Type it below.";
  return "Type it in the chat.";
}

function Reel({ value, spinning, accent, label }) {
  return (
    <div className="min-w-0">
      <p className="label-mono mb-1.5 text-center text-fog-light">{label}</p>
      <div className="relative h-[4.75rem] overflow-hidden rounded-xl border-2 border-ink bg-cream shadow-[3px_3px_0_#21201C]">
        <div
          key={`${spinning ? "whir" : "land"}:${value}`}
          className={`flex h-full items-center justify-center px-2 text-center text-[12px] font-medium leading-snug sm:text-[13px] ${accent} ${
            spinning ? "roulette-whir" : "roulette-land"
          }`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * Empty-preview start panel: typing in chat is the main path; the three-reel
 * spin is an optional gag underneath. `chatHint` points at the one composer
 * so we never add a second text box.
 *
 * @param {{
 *   variant?: "hero" | "again",
 *   chatHint?: "left" | "below" | "chat",
 *   busy?: boolean,
 *   disabled?: boolean,
 *   onSpin: (prompt: string) => void,
 *   onSpinStart?: () => void,
 * }} props
 */
export default function DraftRoulette({
  variant = "hero",
  chatHint = "left",
  busy = false,
  disabled = false,
  onSpin,
  onSpinStart,
}) {
  const compact = variant === "again";
  const [values, setValues] = useState(() => [
    REEL_BANKS[0][0],
    REEL_BANKS[1][0],
    REEL_BANKS[2][0],
  ]);
  const [whirling, setWhirling] = useState([false, false, false]);
  const [phase, setPhase] = useState("idle"); // idle | spinning | building
  const valuesRef = useRef(values);
  const timersRef = useRef([]);
  const intervalsRef = useRef([]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    if (phase !== "idle" || prefersReducedMotion()) return undefined;
    const id = setInterval(() => {
      const reel = Math.floor(Math.random() * 3);
      setValues((prev) => {
        const next = [...prev];
        next[reel] = pickReelItem(REEL_BANKS[reel], prev[reel]);
        return next;
      });
    }, IDLE_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (busy && phase === "spinning") setPhase("building");
    if (!busy && phase === "building") setPhase("idle");
  }, [busy, phase]);

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      intervalsRef.current.forEach((t) => clearInterval(t));
    },
    [],
  );

  function clearTimers() {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
    intervalsRef.current.forEach((t) => clearInterval(t));
    intervalsRef.current = [];
  }

  function spin() {
    if (disabled || busy || phase !== "idle") return;
    const current = valuesRef.current;
    const landed = pickSpin(current);

    if (prefersReducedMotion()) {
      setValues([landed.vibe, landed.material, landed.twist]);
      setPhase("building");
      onSpinStart?.();
      onSpin(buildSpinPrompt(landed));
      return;
    }

    setPhase("spinning");
    setWhirling([true, true, true]);
    onSpinStart?.();
    clearTimers();

    const whirIds = REEL_BANKS.map((bank, i) =>
      setInterval(() => {
        setValues((prev) => {
          const next = [...prev];
          next[i] = pickReelItem(bank, prev[i]);
          return next;
        });
      }, WHIR_MS),
    );
    intervalsRef.current = whirIds;

    STOP_AT.forEach((ms, i) => {
      const stopId = setTimeout(() => {
        clearInterval(whirIds[i]);
        setWhirling((prev) => {
          const next = [...prev];
          next[i] = false;
          return next;
        });
        const final =
          i === 0 ? landed.vibe : i === 1 ? landed.material : landed.twist;
        setValues((prev) => {
          const next = [...prev];
          next[i] = final;
          return next;
        });
      }, ms);
      timersRef.current.push(stopId);
    });

    const doneId = setTimeout(() => {
      whirIds.forEach(clearInterval);
      setWhirling([false, false, false]);
      setValues([landed.vibe, landed.material, landed.twist]);
      setPhase("building");
      onSpin(buildSpinPrompt(landed));
    }, STOP_AT[2] + 120);
    timersRef.current.push(doneId);
  }

  const locked = disabled || busy || phase !== "idle";
  const inMotion = phase === "spinning" || phase === "building";

  return (
    <section
      className={
        compact
          ? "punch-card-sm px-4 py-3"
          : "punch-card -rotate-1 px-5 py-5 sm:px-7 sm:py-6"
      }
      aria-label="Start this build"
    >
      {!compact && !inMotion ? (
        <>
          <p className="label-mono">First prompt</p>
          <h2 className="mt-2 text-[22px] font-medium leading-tight tracking-tight text-ink sm:text-[26px]">
            Enter your first prompt
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fog">
            {hintCopy(chatHint)} Or spin a random first draft.
          </p>
        </>
      ) : null}

      {inMotion ? (
        <p className="label-mono text-center" aria-live="polite">
          {phase === "spinning" ? "Spinning…" : "Building it…"}
        </p>
      ) : compact ? (
        <p className="label-mono">Or spin a random draft</p>
      ) : null}

      <div
        className={`grid grid-cols-3 gap-2 ${compact || inMotion ? "mt-3" : "mt-5"}`}
        aria-live="polite"
      >
        <Reel
          label="Vibe"
          value={values[0]}
          spinning={whirling[0]}
          accent={ACCENTS[0]}
        />
        <Reel
          label="Look"
          value={values[1]}
          spinning={whirling[1]}
          accent={ACCENTS[1]}
        />
        <Reel
          label="Twist"
          value={values[2]}
          spinning={whirling[2]}
          accent={ACCENTS[2]}
        />
      </div>

      <div className={`flex flex-col items-center ${compact ? "mt-3" : "mt-5"}`}>
        <button
          type="button"
          onClick={spin}
          disabled={locked}
          className={`btn-pill ${compact ? "px-5 py-2.5" : "px-8 py-3 text-[12px] shadow-[4px_4px_0_#F59E0B]"}`}
        >
          {phase === "spinning"
            ? "Spinning…"
            : phase === "building"
              ? "Building it…"
              : "Spin a random draft"}
        </button>
        {!inMotion ? (
          <p className="mt-2 text-center text-xs text-fog-light">
            Optional — uses credits.
          </p>
        ) : (
          <p className="mt-2 text-center text-xs text-fog-light">
            {values[0]} · {values[1]} · {values[2]}
          </p>
        )}
      </div>
    </section>
  );
}
