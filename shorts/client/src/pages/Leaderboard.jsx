import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchLeaderboard } from "@/api/vote";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import { fetchChallengePeriod } from "@/lib/challengePeriod";
import ShortsHeader from "@/components/ShortsHeader";

const TOP_DOT = {
  1: "bg-accent-amber",
  2: "bg-accent-violet",
  3: "bg-accent-blue",
};

export default function Leaderboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDate = searchParams.get("challengeDate");
  const [period, setPeriod] = useState(null);
  const [challengeDate, setChallengeDate] = useState(urlDate || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchChallengePeriod();
        if (cancelled) return;
        setPeriod(p);
        if (!urlDate) setChallengeDate(p.periodKey);
      } catch {
        if (!cancelled && !urlDate) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlDate]);

  useEffect(() => {
    if (urlDate) setChallengeDate(urlDate);
  }, [urlDate]);

  useEffect(() => {
    if (!challengeDate) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchLeaderboard({
          challengeDate,
          limit: 50,
          anonymousId,
        });
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challengeDate, anonymousId]);

  function onDateChange(value) {
    setChallengeDate(value);
    const currentKey = period?.periodKey;
    setSearchParams(
      currentKey && value === currentKey ? {} : { challengeDate: value },
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <ShortsHeader active="leaderboard" cta={{ label: "Vote", to: "/Vote" }} />

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium tracking-tight text-ink">
              Leaderboard
            </h1>
            <p className="mt-1 text-sm text-fog-light">
              Ranked by community votes
            </p>
          </div>
          <label className="label-mono block">
            Challenge date
            <input
              type="date"
              value={challengeDate}
              onChange={(e) => onDateChange(e.target.value)}
              disabled={!challengeDate}
              className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2 font-mono text-sm text-ink focus:border-ink focus:outline-none disabled:opacity-50"
            />
          </label>
        </div>

        {data?.you && (
          <div className="mb-4 rounded-2xl border border-line bg-cream px-5 py-3">
            <p className="label-mono">Your rank</p>
            <p className="mt-1 font-mono text-sm text-ink">
              #{data.you.rank ?? "—"} · score {data.you.score} · {data.you.wins}
              -{data.you.losses}
              {data.you.provisional ? " · provisional" : ""}
            </p>
            <p className="mt-1 text-xs text-fog-light">
              Your highest-ranked build. Every build you submitted is ranked
              separately below.
            </p>
          </div>
        )}

        {loading && <p className="text-sm text-fog-light">Loading…</p>}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && data && data.entries.length === 0 && (
          <div className="rounded-2xl border border-line bg-paper px-4 py-10 text-center shadow-card">
            <p className="text-[22px] font-medium tracking-tight text-ink">
              No rankings yet
            </p>
            <p className="mt-2 text-sm text-fog-light">
              Submit a build, then vote to start ranking.
            </p>
          </div>
        )}

        {data && data.entries.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="label-mono px-3 py-3 sm:px-5">Rank</th>
                  <th className="label-mono px-3 py-3 sm:px-5">Builder</th>
                  <th className="label-mono px-3 py-3 sm:px-5">Score</th>
                  <th className="label-mono px-3 py-3 sm:px-5">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.entries.map((row) => (
                  <tr
                    key={row.id}
                    className={row.isMine ? "bg-cream" : undefined}
                  >
                    <td
                      className={`whitespace-nowrap px-3 py-3.5 font-mono text-sm sm:px-5 ${
                        row.rank === 1 ? "text-ink" : "text-fog-light"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {TOP_DOT[row.rank] ? (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${TOP_DOT[row.rank]}`}
                          />
                        ) : (
                          <span className="h-1.5 w-1.5" />
                        )}
                        #{row.rank}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 sm:px-5">
                      <Link
                        to={`/Submission?id=${row.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {row.displayName}
                      </Link>
                      {row.isMine ? (
                        <span className="ml-2 font-mono text-[10px] uppercase text-accent-blue">
                          you
                        </span>
                      ) : null}
                      {row.provisional ? (
                        <span className="ml-2 font-mono text-[10px] uppercase text-accent-amber">
                          provisional
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 font-mono text-fog sm:px-5">
                      {row.score}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 font-mono text-fog sm:px-5">
                      {row.wins}-{row.losses}
                      <span className="ml-1 hidden text-fog-light sm:inline">
                        ({row.matches})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
