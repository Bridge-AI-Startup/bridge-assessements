import { useState } from "react";
import SessionWaitlist from "@/components/SessionWaitlist";

/**
 * Dev-only visual preview of the Build session waitlist UI.
 * Does not call the API or join a real queue.
 */
export default function QueuePreview() {
  const [activeCount, setActiveCount] = useState(5);
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState(45);

  return (
    <div className="relative min-h-screen bg-paper">
      <div className="absolute left-4 right-4 top-4 z-10 mx-auto max-w-lg rounded-lg border border-line bg-mist/95 p-4 shadow-sm backdrop-blur sm:left-6 sm:right-auto">
        <p className="label-mono">UI preview only</p>
        <p className="mt-1 text-sm text-fog">
          Mock waitlist UI — no real queue. Build auto-polls every 3s when
          queued.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-fog">
            activeCount
            <input
              type="number"
              min={0}
              value={activeCount}
              onChange={(e) => setActiveCount(Number(e.target.value) || 0)}
              className="rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fog">
            maxConcurrent
            <input
              type="number"
              min={0}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value) || 0)}
              className="rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fog">
            estimatedWaitSeconds
            <input
              type="number"
              min={0}
              value={estimatedWaitSeconds}
              onChange={(e) =>
                setEstimatedWaitSeconds(Number(e.target.value) || 0)
              }
              className="rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-pill-secondary text-xs"
            onClick={() => setEstimatedWaitSeconds(45)}
          >
            Wait 45s
          </button>
          <button
            type="button"
            className="btn-pill-secondary text-xs"
            onClick={() => setEstimatedWaitSeconds(90)}
          >
            Wait 90s (~2 min)
          </button>
          <button
            type="button"
            className="btn-pill-secondary text-xs"
            onClick={() => {
              setActiveCount(5);
              setMaxConcurrent(5);
              setEstimatedWaitSeconds(45);
            }}
          >
            Reset defaults
          </button>
        </div>
      </div>

      <SessionWaitlist
        activeCount={activeCount}
        maxConcurrent={maxConcurrent}
        estimatedWaitSeconds={estimatedWaitSeconds}
      />
    </div>
  );
}
