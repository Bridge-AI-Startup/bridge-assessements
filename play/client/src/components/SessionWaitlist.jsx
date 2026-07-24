import { Link } from "react-router-dom";

/**
 * Waitlist UI shown when all concurrent Play build seats are full.
 */
export default function SessionWaitlist({
  activeCount,
  maxConcurrent,
  estimatedWaitSeconds,
  showBackLink = true,
}) {
  const safeActive = Math.max(0, Number(activeCount) || 0);
  const safeMax = Math.max(0, Number(maxConcurrent) || 0);
  const spotsFree =
    safeMax > 0 ? Math.max(0, safeMax - safeActive) : 0;
  const spotsInUse = safeMax > 0 ? Math.min(safeActive, safeMax) : safeActive;
  const isFull = safeMax > 0 ? spotsFree === 0 : true;

  const waitHint =
    estimatedWaitSeconds >= 60
      ? `~${Math.ceil(estimatedWaitSeconds / 60)} min`
      : `~${estimatedWaitSeconds}s`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />

        <h1 className="mt-6 text-[22px] font-medium tracking-tight text-ink">
          {isFull
            ? "All build spots are taken right now"
            : "A build spot just opened"}
        </h1>
        <p className="mt-2 text-sm text-fog">
          {isFull ? (
            <>
              You&apos;re waiting for the next open spot. We&apos;ll start your
              workspace automatically when one frees up.
            </>
          ) : (
            <>Checking for a free seat and starting your workspace…</>
          )}
        </p>

        <div className="mt-10">
          {safeMax > 0 ? (
            isFull ? (
              <>
                <p className="font-mono text-7xl font-medium leading-none tracking-tight text-ink tabular-nums">
                  {spotsInUse}
                </p>
                <p className="label-mono mt-3">Spots until a build opens</p>
              </>
            ) : (
              <>
                <p className="font-mono text-7xl font-medium leading-none tracking-tight text-ink tabular-nums">
                  {spotsFree}
                </p>
                <p className="label-mono mt-3">Spots open now</p>
              </>
            )
          ) : (
            <>
              <p className="font-mono text-5xl font-medium leading-none tracking-tight text-ink">
                Full
              </p>
              <p className="label-mono mt-3">All build spots busy</p>
            </>
          )}
        </div>

        <p className="mt-8 text-sm text-fog">
          A spot opens when someone leaves, submits, or their time runs out.
        </p>
        <p className="label-mono mt-5">Typical wait {waitHint}</p>

        {showBackLink ? (
          <div className="mt-8">
            <Link to="/" className="text-sm text-fog-light hover:underline">
              Back to Home
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
