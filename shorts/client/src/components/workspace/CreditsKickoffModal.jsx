import { useEffect } from "react";
import { compactTokens } from "@/components/workspace/TokenGauge";

/**
 * Kickoff sticker shown once when a new Build session starts.
 * Credits are the only budget a builder has — this is the visual of that number,
 * not a gate.
 *
 * @param {{
 *   tokenBudget: number,
 *   onClose: () => void,
 * }} props
 */
export default function CreditsKickoffModal({ tokenBudget, onClose }) {
  const credits = Math.max(0, Number(tokenBudget) || 0);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-kickoff-title"
      onClick={onClose}
    >
      <div
        className="punch-card w-full max-w-sm rotate-[-1.5deg] bg-paper px-6 py-7 text-center"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="label-mono text-fog">This build</p>
        <h2
          id="credits-kickoff-title"
          className="mt-2 text-[22px] font-medium tracking-tight text-ink"
        >
          You&rsquo;ve got credits
        </h2>
        <p
          className="mt-4 font-mono text-[42px] font-semibold leading-none tabular-nums text-ink"
          style={{ letterSpacing: "-0.04em" }}
        >
          {credits.toLocaleString()}
        </p>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-label text-fog">
          {compactTokens(credits)} to spend on prompts
        </p>
        <p className="mt-4 text-sm text-fog-light">
          Same challenge, same model, same pile of credits. Make something
          you&rsquo;d rather keep open.
        </p>
        <button type="button" onClick={onClose} className="btn-pill mt-6 px-8">
          Let&rsquo;s go
        </button>
      </div>
    </div>
  );
}
