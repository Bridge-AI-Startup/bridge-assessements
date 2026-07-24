import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { castVote, fetchVoteNext } from "@/api/vote";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import {
  fetchChallengePeriod,
  periodNoun,
} from "@/lib/challengePeriod";
import PlayHeader from "@/components/PlayHeader";

function PreviewPane({ card, side, onPick, disabled }) {
  const preview = useSubmissionPreview({
    submissionId: card?.id,
    previewRevision: card?.previewRevision ?? card?.submittedAt,
    files: card?.files,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <p className="text-sm font-medium text-ink">{card.displayName}</p>
          <p className="font-mono text-[11px] text-fog-light">
            score {card.score} · {card.wins}-{card.losses}
            {card.provisional ? " · provisional" : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(side)}
          className="btn-pill"
        >
          Pick this
        </button>
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
  );
}

function RoundMeter({ round, periodLabel }) {
  if (!round) return null;
  const progressPct = Math.min(
    100,
    (round.votesInRound / round.roundSize) * 100,
  );
  return (
    <div className="min-w-[160px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-ink">
          Vote {Math.min(round.votesInRound, round.roundSize)} / {round.roundSize}
        </span>
        <span className="font-mono text-[11px] text-fog-light">
          {round.votesToday}/{round.maxVotes} {periodLabel}
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
  const periodLabel =
    cadence === "weekly" ? "this week" : "today";
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

  const round =
    state.kind === "pair" || state.kind === "recap" || state.kind === "empty"
      ? state.data.round
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <PlayHeader active="vote">
        <RoundMeter round={round} periodLabel={periodLabel} />
      </PlayHeader>

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
          <div className="mx-auto max-w-md rounded-2xl border border-line bg-paper px-5 py-8 text-center shadow-card">
            <h1 className="text-[22px] font-medium tracking-tight text-ink">
              {state.data.reason === "must_submit"
                ? "Submit first"
                : state.data.reason === "vote_cap_reached"
                  ? cadence === "weekly"
                    ? "Weekly vote limit reached"
                    : "Daily vote limit reached"
                  : state.data.reason === "no_pairs_left"
                    ? "All matchups done"
                    : "No matchups"}
            </h1>
            <p className="mt-2 text-sm text-fog">{state.data.message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {state.data.reason === "must_submit" && (
                <Link to="/Build" className="btn-pill">
                  Start building
                </Link>
              )}
              <Link to="/Gallery" className="btn-pill-secondary">
                Browse builds
              </Link>
              <Link to="/Leaderboard" className="btn-pill-secondary">
                Leaderboard
              </Link>
            </div>
          </div>
        )}

        {state.kind === "recap" && state.data.recap && (
          <div className="mx-auto w-full max-w-2xl rounded-2xl border border-line bg-paper p-6 shadow-card">
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
              ) : state.data.allPairsComplete ? (
                <p className="text-sm text-fog-light">
                  You&apos;ve compared every unique matchup for this {noun}.
                </p>
              ) : (
                <p className="text-sm text-fog-light">
                  You&apos;ve used all {state.data.round.maxVotes} ranking votes
                  for this {noun}.
                </p>
              )}
              <Link to="/Leaderboard" className="btn-pill-secondary">
                View leaderboard
              </Link>
            </div>
          </div>
        )}

        {state.kind === "pair" && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <p className="text-center text-sm text-fog">
              Which build is better? Hit{" "}
              <span className="font-mono text-ink">
                {round?.votesInRound}/{round?.roundSize}
              </span>{" "}
              to unlock your round recap.
            </p>
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
              <PreviewPane
                card={state.data.left}
                side="left"
                onPick={pick}
                disabled={busy}
              />
              <PreviewPane
                card={state.data.right}
                side="right"
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
