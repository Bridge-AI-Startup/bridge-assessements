import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTodayChallenge } from "@/api/challenge";
import { listSubmissions } from "@/api/submissions";
import ShortsHeader from "@/components/ShortsHeader";
import Markdown from "@/components/Markdown";
import SubmissionCard from "@/components/gallery/SubmissionCard";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import {
  fetchChallengePeriod,
  periodPossessive,
} from "@/lib/challengePeriod";

function formatPeriodHeading(periodKey, cadence) {
  const [year, month, day] = periodKey.split("-").map(Number);
  if (cadence === "weekly") {
    const start = new Date(Date.UTC(year, month - 1, day));
    const end = new Date(Date.UTC(year, month - 1, day + 6));
    const fmt = (d) =>
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    return `Week of ${fmt(start)} – ${fmt(end)}, ${year}`;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const CATEGORY_CHIP = {
  widget: "bg-accent-emerald/10 text-accent-emerald",
  game: "bg-accent-violet/10 text-accent-violet",
  tool: "bg-accent-blue/10 text-accent-blue",
  other: "bg-mist text-fog",
};

const HOME_BROWSE_LIMIT = 6;

export default function Home() {
  const [state, setState] = useState({ kind: "loading" });
  const [period, setPeriod] = useState(null);
  const [browse, setBrowse] = useState({
    kind: "loading",
    items: [],
    total: 0,
  });
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);

  useEffect(() => {
    fetchChallengePeriod().then(setPeriod).catch(() => setPeriod(null));
    fetchTodayChallenge().then((result) => {
      if (result.status === "ok") {
        setState({ kind: "challenge", challenge: result.challenge });
        if (result.challenge.cadence || result.challenge.periodEndsAt) {
          setPeriod({
            cadence: result.challenge.cadence || "weekly",
            periodKey: result.challenge.challengeDate,
            periodEndsAt: result.challenge.periodEndsAt || "",
            label:
              result.challenge.cadence === "daily" ? "Today" : "This week",
          });
        }
      } else if (result.status === "no_challenge_today") {
        setState({ kind: "empty" });
      } else {
        setState({ kind: "error", message: result.message });
      }
    });
  }, []);

  const cadence = period?.cadence || "weekly";
  const possessive = periodPossessive(cadence);
  const browseDate =
    state.kind === "challenge"
      ? state.challenge.challengeDate
      : period?.periodKey;

  useEffect(() => {
    if (state.kind === "loading" || !browseDate) return undefined;

    let cancelled = false;
    (async () => {
      setBrowse({ kind: "loading", items: [], total: 0 });
      try {
        const result = await listSubmissions({
          challengeDate: browseDate,
          limit: HOME_BROWSE_LIMIT,
          anonymousId,
        });
        if (cancelled) return;
        setBrowse({
          kind: "ready",
          items: result.submissions || [],
          total: result.total || 0,
          challengeDate: result.challengeDate || browseDate,
        });
      } catch (err) {
        if (!cancelled) {
          setBrowse({
            kind: "error",
            items: [],
            total: 0,
            message: err instanceof Error ? err.message : "Failed to load",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.kind, browseDate, anonymousId]);

  const headline =
    cadence === "weekly"
      ? "Build this week's challenge."
      : "Build today's challenge.";

  return (
    <div className="min-h-screen bg-paper">
      <ShortsHeader active={null} />

      <main className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
        {state.kind === "loading" && (
          <p className="text-sm text-fog-light">
            Loading {possessive} challenge…
          </p>
        )}

        {state.kind === "error" && (
          <div className="max-w-xl rounded-2xl border border-red-200 bg-red-50 px-4 py-6">
            <p className="font-medium text-red-800">Could not load challenge</p>
            <p className="mt-1 text-sm text-red-600">{state.message}</p>
          </div>
        )}

        {state.kind === "empty" && (
          <div className="grid gap-10 lg:grid-cols-2 lg:items-end lg:gap-16">
            <div>
              <h1 className="max-w-xl text-[40px] font-medium leading-[1.1] tracking-tight lg:text-[48px]">
                <span className="text-ink">{headline}</span>{" "}
                <span className="text-fog-light">Ship something small, fast.</span>
              </h1>
            </div>
            <div className="rounded-2xl border border-line bg-paper px-6 py-10 shadow-card">
              <p className="text-[22px] font-medium tracking-tight text-ink">
                {cadence === "weekly"
                  ? "No challenge this week"
                  : "No challenge today"}
              </p>
              <p className="mt-2 text-sm text-fog-light">
                Check back soon for the next build.
              </p>
            </div>
          </div>
        )}

        {state.kind === "challenge" && (
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
            <div className="lg:sticky lg:top-12 lg:pt-2">
              <h1 className="max-w-xl text-[40px] font-medium leading-[1.1] tracking-tight lg:text-[48px]">
                <span className="text-ink">{headline}</span>{" "}
                <span className="text-fog-light">Ship something small, fast.</span>
              </h1>
              <p className="label-mono mt-5">
                {formatPeriodHeading(
                  state.challenge.challengeDate,
                  state.challenge.cadence || cadence,
                )}
              </p>
              <div className="mt-8 hidden gap-3 lg:flex">
                <Link to="/Build" className="btn-pill px-6 py-3">
                  Start building
                </Link>
                <Link to="/Gallery" className="btn-pill-secondary px-6 py-3">
                  Browse builds
                </Link>
              </div>
            </div>

            <article className="rounded-2xl border border-line bg-paper shadow-card">
              <div className="border-b border-line px-6 py-5 sm:px-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-mist px-2.5 py-0.5 font-mono text-[11px] text-fog">
                    #{state.challenge.slug}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] capitalize ${
                      CATEGORY_CHIP[state.challenge.category] ||
                      CATEGORY_CHIP.other
                    }`}
                  >
                    {state.challenge.category}
                  </span>
                </div>
                <h2 className="mt-3 text-[22px] font-medium tracking-tight text-ink sm:text-[26px]">
                  {state.challenge.title}
                </h2>
              </div>

              <div className="px-6 py-5 sm:px-8 sm:py-6">
                <Markdown text={state.challenge.prompt} />
              </div>

              <div className="border-t border-line px-6 py-3 sm:px-8">
                <p className="label-mono">
                  {state.challenge.tokenBudget.toLocaleString()} token budget
                </p>
              </div>

              <div className="border-t border-line px-6 py-5 sm:px-8 lg:hidden">
                <Link to="/Build" className="btn-pill w-full py-3">
                  Start building
                </Link>
                <p className="mt-2 text-center text-xs text-fog-light">
                  Opens a cloud workspace — Preview shows your{" "}
                  <code className="rounded bg-mist px-1 font-mono">
                    index.html
                  </code>
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link to="/Gallery" className="label-mono hover:text-ink">
                    Browse
                  </Link>
                  <span className="text-line">·</span>
                  <Link to="/Vote" className="label-mono hover:text-ink">
                    Vote
                  </Link>
                </div>
              </div>
            </article>
          </div>
        )}

        {state.kind !== "loading" && browseDate && (
          <section className="mt-16 border-t border-line pt-12 lg:mt-20">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[28px] font-medium tracking-tight text-ink">
                  Browse builds
                </h2>
                <p className="mt-1 text-sm text-fog-light">
                  {browse.kind === "ready"
                    ? `${browse.total} submission${browse.total === 1 ? "" : "s"} ${cadence === "weekly" ? "this week" : "today"}`
                    : cadence === "weekly"
                      ? "This week's submissions"
                      : "Today's submissions"}
                </p>
              </div>
              <Link to="/Gallery" className="label-mono hover:text-ink">
                View all →
              </Link>
            </div>

            {browse.kind === "loading" && (
              <p className="text-sm text-fog-light">Loading submissions…</p>
            )}

            {browse.kind === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {browse.message}
              </div>
            )}

            {browse.kind === "ready" && browse.items.length === 0 && (
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

            {browse.kind === "ready" && browse.items.length > 0 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {browse.items.map((item) => (
                    <SubmissionCard key={item.id} item={item} />
                  ))}
                </div>
                {browse.total > browse.items.length ? (
                  <div className="mt-8 text-center">
                    <Link to="/Gallery" className="btn-pill-secondary px-6 py-3">
                      See all {browse.total} builds
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
