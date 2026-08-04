import { useEffect, useState } from "react";
import {
  formatElapsed,
  nextWaitBit,
  statusLineFor,
} from "@/lib/waitingRoom";
import { WAIT_GAMES } from "@/components/workspace/waitGames";

/**
 * Shown in the chat stream while a build turn is in flight.
 *
 * A turn is one blocking call with no progress stream, so instead of a bare
 * spinner this pairs the elapsed timer with a riddle / knock-knock / joke or
 * a small minigame the builder can play with, all confined to this card. The
 * bit is re-drawn each time a new wait starts.
 *
 * @param {{ active: boolean }} props
 */
export default function BuildWaitCard({ active }) {
  const [elapsed, setElapsed] = useState(0);
  const [bit, setBit] = useState(() => nextWaitBit(null));
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    // New wait: fresh bit, fresh timer.
    setElapsed(0);
    setStep(0);
    setBit((previous) => nextWaitBit(previous?.id ?? null));
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const Game = bit.kind === "game" ? WAIT_GAMES[bit.game] : null;
  const visibleSteps = Game ? [] : bit.steps.slice(0, step + 1);
  const reveal = Game ? null : bit.steps[step]?.cta;

  function drawAnother() {
    setBit((previous) => nextWaitBit(previous?.id ?? null));
    setStep(0);
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] overflow-hidden rounded-2xl rounded-bl-md border border-line bg-mist">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="flex gap-1" aria-hidden="true">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-fog-light"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span className="text-xs text-fog" aria-live="polite">
            {statusLineFor(elapsed)}
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-fog-light">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="border-t border-line bg-paper px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="label-mono text-fog-light">{bit.label}</span>
            <button
              type="button"
              onClick={drawAnother}
              className="label-mono hover:text-ink"
            >
              Another
            </button>
          </div>

          {Game ? (
            // Key by bit id so drawing the same game later starts it fresh.
            <div className="mt-2">
              <Game key={bit.id} />
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {visibleSteps.map((line, index) => (
                <p
                  key={`${bit.id}-${index}`}
                  className={`text-sm ${
                    index === visibleSteps.length - 1 ? "text-ink" : "text-fog"
                  }`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          )}

          {reveal ? (
            <button
              type="button"
              onClick={() => setStep((current) => current + 1)}
              className="btn-pill-secondary mt-3"
            >
              {reveal}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
