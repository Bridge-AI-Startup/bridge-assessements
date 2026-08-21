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
 * spin is an optional gag underneath. After a spin lands, the builder sees the
 * result and chooses Build that / Spin again — never auto-starts a turn.
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
  // idle → spinning → revealed → building (only after "Build that")
  const [phase, setPhase] = useState("idle");
  const [landed, setLanded] = useState(null);
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
    if (busy && phase === "building") return;
    if (!busy && phase === "building") {
      setPhase("idle");
      setLanded(null);
    }
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

  function landResult(result) {
    setValues([result.vibe, result.material, result.twist]);
    setWhirling([false, false, false]);
    setLanded(result);
    setPhase("revealed");
  }

  function spin() {
    if (disabled || busy || (phase !== "idle" && phase !== "revealed")) return;
    const current = valuesRef.current;
    const nextLanded = pickSpin(current);

    if (prefersReducedMotion()) {
      landResult(nextLanded);
      return;
    }

    setPhase("spinning");
    setLanded(null);
    setWhirling([true, true, true]);
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
          i === 0
            ? nextLanded.vibe
            : i === 1
              ? nextLanded.material
              : nextLanded.twist;
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
      landResult(nextLanded);
    }, STOP_AT[2] + 120);
    timersRef.current.push(doneId);
  }

  function buildLanded() {
    if (!landed || disabled || busy || phase !== "revealed") return;
    setPhase("building");
    onSpinStart?.();
    onSpin(buildSpinPrompt(landed));
  }

  const canSpin =
    !disabled && !busy && (phase === "idle" || phase === "revealed");
  const inMotion = phase === "spinning" || phase === "building";
  const showResult = phase === "revealed" || phase === "building";

  return (
    <section
      className={
        compact
          ? "punch-card-sm px-4 py-3"
          : "punch-card -rotate-1 px-5 py-5 sm:px-7 sm:py-6"
      }
      aria-label="Start this build"
    >
      {!compact && phase === "idle" ? (
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

      {phase === "spinning" ? (
        <p className="label-mono text-center" aria-live="polite">
          Spinning…
        </p>
      ) : phase === "revealed" ? (
        <p className="label-mono text-center" aria-live="polite">
          You got
        </p>
      ) : phase === "building" ? (
        <p className="label-mono text-center" aria-live="polite">
          Building it…
        </p>
      ) : compact ? (
        <p className="label-mono">Or spin a random draft</p>
      ) : null}

      <div
        className={`grid grid-cols-3 gap-2 ${
          compact || phase !== "idle" ? "mt-3" : "mt-5"
        }`}
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
        {phase === "revealed" ? (
          <>
            <p className="mb-3 text-center text-sm font-medium text-ink">
              {values[0]} · {values[1]} · {values[2]}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={spin}
                disabled={!canSpin}
                className="btn-pill-secondary px-5 py-2.5"
              >
                Spin again
              </button>
              <button
                type="button"
                onClick={buildLanded}
                disabled={disabled || busy}
                className={`btn-pill ${compact ? "px-5 py-2.5" : "px-8 py-3 text-[12px] shadow-[4px_4px_0_#F59E0B]"}`}
              >
                Build that
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-fog-light">
              Building uses credits.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={spin}
              disabled={!canSpin}
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
                Optional — uses credits when you build.
              </p>
            ) : showResult ? (
              <p className="mt-2 text-center text-xs text-fog-light">
                {values[0]} · {values[1]} · {values[2]}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
