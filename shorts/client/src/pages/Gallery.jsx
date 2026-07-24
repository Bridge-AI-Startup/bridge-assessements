import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listSubmissions } from "@/api/submissions";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import {
  fetchChallengePeriod,
  periodPossessive,
} from "@/lib/challengePeriod";
import ShortsHeader from "@/components/ShortsHeader";
import SubmissionCard from "@/components/gallery/SubmissionCard";

export default function Gallery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDate = searchParams.get("challengeDate");
  const [period, setPeriod] = useState(null);
  const [challengeDate, setChallengeDate] = useState(urlDate || "");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
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
        const result = await listSubmissions({
          challengeDate,
          limit: 100,
          anonymousId,
        });
        if (cancelled) return;
        setItems(result.submissions || []);
        setTotal(result.total || 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setItems([]);
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

  const possessive = periodPossessive(period?.cadence || "weekly");

  return (
    <div className="min-h-screen bg-paper">
      <ShortsHeader
        active="browse"
        cta={{ label: "Start voting", to: "/Vote" }}
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium tracking-tight text-ink">
              Browse builds
            </h1>
            <p className="mt-1 text-sm text-fog-light">
              {total} submission{total === 1 ? "" : "s"} for{" "}
              <span className="font-mono">{challengeDate || "…"}</span> — click a
              preview to open
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

        {loading && (
          <p className="text-center text-sm text-fog-light">
            Loading submissions…
          </p>
        )}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl border border-line bg-paper px-4 py-10 text-center shadow-card">
            <p className="text-[22px] font-medium tracking-tight text-ink">
              No submissions yet
            </p>
            <p className="mt-2 text-sm text-fog-light">
              Be the first to{" "}
              <Link to="/Build" className="text-ink underline">
                build {possessive} challenge
              </Link>
              .
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <SubmissionCard key={item.id} item={item} />
          ))}
        </div>
      </main>
    </div>
  );
}
