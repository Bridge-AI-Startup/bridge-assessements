import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { castVote, fetchVoteNext } from "@/api/vote";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import {
  fetchChallengePeriod,
  periodNoun,
} from "@/lib/challengePeriod";
import ShortsHeader from "@/components/ShortsHeader";

function PreviewPane({ card, side, label, onPick, disabled }) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const preview = useSubmissionPreview({
    submissionId: card?.id,
    previewRevision: card?.previewRevision ?? card?.submittedAt,
    files: card?.files,
  });

  const minimize = useCallback(() => {
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setExpanded(false);
      setClosing(false);
    }, 150);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // New matchup → snap back to the card instantly.
  useEffect(() => {
    clearTimeout(closeTimer.current);
    setExpanded(false);
    setClosing(false);
  }, [card?.id]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") minimize();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded, minimize]);

  return (
    <div
      className={
        expanded
          ? "h-[70vh] rounded-2xl border border-dashed border-line lg:h-auto lg:min-h-0"
          : "flex h-[70vh] flex-col lg:h-auto lg:min-h-0"
      }
    >
      {expanded && (
        <div
          className={`fixed inset-0 z-[59] bg-ink/40 ${
            closing ? "vote-backdrop-exit" : "vote-backdrop-enter"
          }`}
          onClick={minimize}
          aria-hidden="true"
        />
      )}
      <div
        className={
          expanded
            ? `fixed inset-x-0 bottom-0 top-14 z-[60] flex flex-col overflow-hidden rounded-t-2xl border-2 border-ink bg-paper shadow-card sm:inset-x-8 sm:inset-y-6 sm:rounded-2xl lg:inset-x-16 ${
                closing ? "vote-pane-exit" : "vote-pane-enter"
              }`
            : "punch-card-sm flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        }
      >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist font-mono text-[11px] font-medium text-ink">
            {label}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {card.displayName}
            </p>
            {/* Ratings are deliberately not shown mid-vote — seeing a score
                anchors the pick. They're in the gallery's ranking instead.
                The header row is tight once the pick pill and expand button
                are in it, so the hint has a shorter phrasing on small screens
                rather than truncating to "…click inside to tr…". */}
            <p className="truncate text-[11px] text-fog-light">
              <span className="sm:hidden">Live — tap to try it</span>
              <span className="hidden sm:inline">
                Live — click inside to try it
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(side)}
            className="btn-pill"
          >
            Pick {label}
          </button>
          <button
            type="button"
            onClick={() => (expanded ? minimize() : setExpanded(true))}
            aria-label={
              expanded ? "Minimize preview" : "Expand preview to full screen"
            }
            title={expanded ? "Minimize (Esc)" : "Expand to full screen"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-mist text-ink transition-colors hover:bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {expanded ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 10h6M14 10V4M14 10l7-7M10 14H4M10 14v6M10 14l-7 7" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {preview?.url ? (
        <iframe
          title={`${side} preview`}
          src={preview.url}
          className="min-h-[280px] w-full flex-1 bg-paper"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-sm text-fog-light">
          No index.html to preview
        </div>
      )}
      </div>
    </div>
  );
}

function RoundMeter({ round }) {
  if (!round) return null;
  const progressPct = Math.min(
    100,
    (round.votesInRound / round.roundSize) * 100,
  );
  // No vote-count budget — people play until every unique pair is seen.
  // A new build that creates combinations reopens matchups. The meter is
  // only the current five-pick round.
  return (
    <div
      className="w-full sm:w-auto sm:min-w-[180px]"
      title={`${round.votesInRound} of ${round.roundSize} picks done in this round`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-ink">
          Pick {Math.min(round.votesInRound + 1, round.roundSize)} of{" "}
          {round.roundSize}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mist">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

export default function Vote() {
  const [searchParams] = useSearchParams();
  const preferId = searchParams.get("preferId") || undefined;
  const urlDate = searchParams.get("challengeDate");
  const [period, setPeriod] = useState(null);
  const [challengeDate, setChallengeDate] = useState(urlDate || "");
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);

  const [state, setState] = useState({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Open on a first visit, then only when the builder asks for it again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchChallengePeriod();
        if (cancelled) return;
        setPeriod(p);
        if (!urlDate) setChallengeDate(p.periodKey);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load period");
          setState({ kind: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlDate]);

  useEffect(() => {
    if (urlDate) setChallengeDate(urlDate);
  }, [urlDate]);

  const cadence = period?.cadence || "weekly";
  const noun = periodNoun(cadence);

  const loadNext = useCallback(async () => {
    if (!challengeDate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchVoteNext({
        anonymousId,
        challengeDate,
        preferId,
        includeFiles: shouldFetchSubmissionFiles,
      });
      if (result.pairAvailable) {
        setState({ kind: "pair", data: result });
      } else {
        setState({ kind: "empty", data: result });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setState({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [anonymousId, challengeDate, preferId]);

  useEffect(() => {
    if (challengeDate) loadNext();
  }, [loadNext, challengeDate]);

  async function pick(side) {
    if (state.kind !== "pair" || busy) return;
    const { left, right, challengeDate: date } = state.data;
    const winner = side === "left" ? left : right;
    const loser = side === "left" ? right : left;
    setBusy(true);
    setError(null);
    try {
      const result = await castVote({
        anonymousId,
        challengeDate: date,
        winnerId: winner.id,
        loserId: loser.id,
        includeFiles: shouldFetchSubmissionFiles,
      });
      if (result.recap) {
        setState({ kind: "recap", data: result });
      } else if (result.weighted === false && !result.pairAvailable) {
        // Unweighted break: never the recap, which describes ranking movement
        // that this player's picks did not cause.
        setState({ kind: "played", data: result });
      } else if (result.pairAvailable && result.left && result.right) {
        setState({
          kind: "pair",
          data: {
            pairAvailable: true,
            challengeDate: result.challengeDate,
            left: result.left,
            right: result.right,
            round: result.round,
            canVote: true,
            weighted: result.weighted,
            pairsRemaining: result.pairsRemaining,
            allPairsComplete: false,
            canContinue: true,
          },
        });
      } else {
        setState({
          kind: "empty",
          data: {
            pairAvailable: false,
            challengeDate: result.challengeDate,
            reason: "no_pairs_left",
            message: result.allPairsComplete
              ? "You're done for now — you've compared every available matchup."
              : "No more pairs right now.",
            round: result.round,
            canVote: false,
            weighted: result.weighted,
            pairsRemaining: result.pairsRemaining,
            allPairsComplete: result.allPairsComplete,
            canContinue: result.canContinue,
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  const hasRound =
    state.kind === "pair" ||
    state.kind === "recap" ||
    state.kind === "empty" ||
    state.kind === "played";
  const round = hasRound ? state.data.round : null;
  const weighted = hasRound ? state.data.weighted !== false : true;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader active="vote">
        <RoundMeter round={round} />
      </ShortsHeader>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-6">
        {error && (
          <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {(state.kind === "loading" || !challengeDate) && (
          <p className="text-center text-sm text-fog-light">
            Finding a matchup…
          </p>
        )}

        {state.kind === "empty" && (
          <div className="punch-card mx-auto max-w-md px-5 py-8 text-center">
            <h1 className="text-[22px] font-medium tracking-tight text-ink">
              {state.data.reason === "no_pairs_left" ||
              state.data.reason === "vote_cap_reached"
                ? "All matchups done"
                : "No matchups"}
            </h1>
            <p className="mt-2 text-sm text-fog">{state.data.message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {!weighted && (
                <Link to="/Build" className="btn-pill">
                  Start building
                </Link>
              )}
              <Link to="/Gallery" className="btn-pill-secondary">
                Browse builds
              </Link>
            </div>
          </div>
        )}

        {state.kind === "played" && (
          <div className="punch-card mx-auto max-w-md px-5 py-8 text-center">
            <div className="label-mono text-fog-light">
              {state.data.round.votesInRound} / {state.data.round.roundSize}{" "}
              picks
            </div>
            <h1 className="mt-2 text-[22px] font-medium tracking-tight text-ink">
              None of them counted
            </h1>
            <p className="mt-2 text-sm text-fog">
              Build one and your picks start moving the ranking.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/Build" className="btn-pill">
                Start building
              </Link>
              {state.data.canContinue && (
                <button
                  type="button"
                  onClick={loadNext}
                  disabled={busy}
                  className="btn-pill-secondary"
                >
                  Keep playing
                </button>
              )}
            </div>
          </div>
        )}

        {state.kind === "recap" && state.data.recap && (
          <div className="punch-card mx-auto w-full max-w-2xl p-6">
            <div className="label-mono text-accent-emerald">
              {state.data.allPairsComplete
                ? "All matchups complete"
                : `Round ${state.data.recap.roundIndex + 1} complete`}{" "}
              · {state.data.round.votesInRound} / {state.data.round.roundSize}
            </div>
            <h1 className="mt-2 text-[22px] font-medium tracking-tight text-ink">
              How your votes moved the board
            </h1>
            <div className="mt-5">
              <h2 className="label-mono">Your picks</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {state.data.recap.choices.map((c, i) => (
                  <li key={`${c.winnerId}-${i}`}>
                    <span className="font-medium text-ink">{c.winnerName}</span>{" "}
                    <span className="text-fog">over {c.loserName}</span>
                  </li>
                ))}
              </ul>
            </div>

            {state.data.recap.biggestMover && (
              <div className="mt-4 rounded-xl bg-accent-emerald/8 px-3 py-2 text-sm text-accent-emerald">
                Biggest mover:{" "}
                <span className="font-medium">
                  {state.data.recap.biggestMover.displayName}
                </span>
                {state.data.recap.biggestMover.beforeRank != null &&
                state.data.recap.biggestMover.afterRank != null ? (
                  <span className="font-mono">
                    {" "}
                    (#{state.data.recap.biggestMover.beforeRank} → #
                    {state.data.recap.biggestMover.afterRank})
                  </span>
                ) : null}
              </div>
            )}

            <div className="mt-5">
              <h2 className="label-mono">Ranking changes</h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {state.data.recap.movements.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2.5 text-sm"
                  >
                    <Link
                      to={`/Submission?id=${m.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {m.displayName}
                    </Link>
                    <span className="font-mono text-fog">
                      {m.beforeRank != null && m.afterRank != null ? (
                        <>
                          #{m.beforeRank} → #{m.afterRank}
                          {m.deltaRank != null && m.deltaRank !== 0 ? (
                            <span
                              className={
                                m.deltaRank > 0
                                  ? "ml-2 text-accent-emerald"
                                  : "ml-2 text-accent-amber"
                              }
                            >
                              {m.deltaRank > 0 ? "↑" : "↓"}
                              {Math.abs(m.deltaRank)}
                            </span>
                          ) : (
                            <span className="ml-2 text-fog-light">—</span>
                          )}
                        </>
                      ) : (
                        <>now #{m.afterRank ?? "—"}</>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {state.data.canContinue ? (
                <button
                  type="button"
                  onClick={loadNext}
                  disabled={busy}
                  className="btn-pill"
                >
                  Play another round
                </button>
              ) : (
                <p className="text-sm text-fog-light">
                  You&apos;ve compared every unique matchup for this {noun}.
                  Check back if more people submit.
                </p>
              )}
              <Link to="/Gallery" className="btn-pill-secondary">
                See the rankings
              </Link>
            </div>
          </div>
        )}

        {state.kind === "pair" && (
          <div className="flex flex-1 flex-col gap-4 lg:min-h-0">
            <p className="text-center text-sm text-ink">
              Try both, then pick the one you&apos;d rather keep open.
            </p>

            {!weighted && (
              <div className="mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-line px-4 py-2">
                <p className="text-sm text-fog">
                  Your picks aren&apos;t counting toward the ranking yet.
                </p>
                <Link to="/Build" className="btn-pill-secondary">
                  Build one
                </Link>
              </div>
            )}

            <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
              <PreviewPane
                card={state.data.left}
                side="left"
                label="A"
                onPick={pick}
                disabled={busy}
              />
              <PreviewPane
                card={state.data.right}
                side="right"
                label="B"
                onPick={pick}
                disabled={busy}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
