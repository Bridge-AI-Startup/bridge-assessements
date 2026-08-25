import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCurrentChallenge } from "@/api/challenge";
import { listSubmissions } from "@/api/submissions";
import ShortsHeader from "@/components/ShortsHeader";
import ShortsFooter from "@/components/ShortsFooter";
import Markdown from "@/components/Markdown";
import SubmissionCard from "@/components/gallery/SubmissionCard";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";

const HOME_BROWSE_LIMIT = 3;

/**
 * Sticker tiles spelling the brand word. White tiles with an ink border and
 * hard shadow (the site's card language), each letter in one of the four
 * accents with a slight hand-placed tilt — deliberately not Wordle's solid
 * colored squares.
 */
const TILE_COLORS = [
  "text-accent-amber",
  "text-accent-violet",
  "text-accent-blue",
  "text-accent-emerald",
];

const TILE_TILTS = [-3, 2, -2, 3, -1, 2];

/** Collapse long briefs behind a teaser so the page reads as a game, not homework. */
const BRIEF_COLLAPSE_THRESHOLD = 280;

function TileRow({ word }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" aria-hidden="true">
      {word.split("").map((letter, i) => (
        <span
          key={`${letter}-${i}`}
          className={`home-tile flex h-10 w-10 select-none items-center justify-center rounded-lg border-2 border-ink bg-paper text-[20px] font-bold shadow-[3px_3px_0_#21201C] sm:h-12 sm:w-12 sm:text-[24px] ${
            TILE_COLORS[i % TILE_COLORS.length]
          }`}
          style={{
            animationDelay: `${i * 80}ms`,
            "--tile-rot": `${TILE_TILTS[i % TILE_TILTS.length]}deg`,
          }}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState({ kind: "loading" });
  const [briefOpen, setBriefOpen] = useState(false);
  const [browse, setBrowse] = useState({
    kind: "loading",
    items: [],
    total: 0,
  });
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);

  useEffect(() => {
    fetchCurrentChallenge().then((result) => {
      if (result.status === "ok") {
        setState({ kind: "challenge", challenge: result.challenge });
      } else if (result.status === "no_active_round") {
        setState({ kind: "empty" });
      } else {
        setState({ kind: "error", message: result.message });
      }
    });
  }, []);

  const browseDate =
    state.kind === "challenge" ? state.challenge.challengeDate : null;

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

  const collapsibleBrief =
    state.kind === "challenge" &&
    (state.challenge.prompt || "").length > BRIEF_COLLAPSE_THRESHOLD;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader active={null} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 lg:py-14">
        {state.kind === "loading" && (
          <p className="text-center text-sm text-fog-light">
            Loading this round&apos;s challenge…
          </p>
        )}

        {state.kind === "error" && (
          <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center">
            <p className="font-medium text-red-800">Could not load challenge</p>
            <p className="mt-1 text-sm text-red-600">{state.message}</p>
          </div>
        )}

        {state.kind === "empty" && (
          <div className="mx-auto max-w-xl text-center">
            <TileRow word="SHORTS" />
            <h1 className="mt-6 text-[36px] font-medium leading-[1.1] tracking-tight text-ink lg:text-[44px]">
              No challenge this round
            </h1>
            <p className="mt-3 text-sm text-fog-light">
              The next round is coming. Meanwhile, the archive is open.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Link to="/Gallery" className="btn-pill-secondary px-6 py-3">
                Browse past builds
              </Link>
              <Link to="/About" className="btn-pill-secondary px-6 py-3">
                What is this?
              </Link>
            </div>
          </div>
        )}

        {state.kind === "challenge" && (
          <div className="mx-auto max-w-2xl text-center">
            <TileRow word="SHORTS" />

            <p className="label-mono mt-6">This round&apos;s challenge</p>

            <h1 className="mt-3 text-[34px] font-medium leading-[1.1] tracking-tight text-ink sm:text-[42px] lg:text-[48px]">
              {state.challenge.title}
            </h1>

            <article className="punch-card home-card-deal mt-8 -rotate-1 px-6 py-5 text-left transition-transform duration-200 hover:rotate-0 sm:px-8 sm:py-6">
              <div
                className={
                  collapsibleBrief && !briefOpen
                    ? "relative max-h-48 overflow-hidden"
                    : ""
                }
              >
                <Markdown text={state.challenge.prompt} />
                {collapsibleBrief && !briefOpen ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper" />
                ) : null}
              </div>
              {collapsibleBrief ? (
                <button
                  type="button"
                  onClick={() => setBriefOpen((v) => !v)}
                  className="label-mono mt-3 hover:text-ink"
                >
                  {briefOpen ? "Hide the brief ↑" : "Read the full brief ↓"}
                </button>
              ) : null}
            </article>

            <div className="mt-10">
              <Link
                to="/Build"
                className="btn-pill px-10 py-4 text-[13px] font-semibold shadow-[4px_4px_0_#F59E0B]"
              >
                Play this round
              </Link>
            </div>

            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-mist px-4 py-2 font-mono text-[12px] tabular-nums text-fog">
              <span>open until the next round</span>
              {browse.kind === "ready" ? <span className="text-line">·</span> : null}
              {browse.kind === "ready" ? (
                <span>
                  {browse.total} build{browse.total === 1 ? "" : "s"} in
                </span>
              ) : null}
              {browse.kind !== "ready" ? <span>&nbsp;</span> : null}
            </div>

            <p className="mt-4 text-sm text-fog-light">
              Everyone gets the same challenge, the same model, and{" "}
              {state.challenge.tokenBudget.toLocaleString()} credits. The
              difference is you.
            </p>
          </div>
        )}

        {state.kind !== "loading" && browseDate && (
          <section className="mx-auto mt-16 max-w-4xl border-t border-line pt-10 lg:mt-20">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-[20px] font-medium tracking-tight text-ink">
                Leading the round
              </h2>
              <div className="flex items-center gap-4">
                <Link to="/Vote" className="label-mono hover:text-ink">
                  Vote →
                </Link>
                <Link to="/Gallery" className="label-mono hover:text-ink">
                  {browse.kind === "ready" && browse.total > 0
                    ? `All ${browse.total} builds →`
                    : "All builds →"}
                </Link>
              </div>
            </div>

            {browse.kind === "loading" && (
              <p className="text-sm text-fog-light">Loading builds…</p>
            )}

            {browse.kind === "error" && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {browse.message}
              </div>
            )}

            {browse.kind === "ready" && browse.items.length === 0 && (
              <p className="text-sm text-fog-light">
                Nobody has submitted yet.{" "}
                <Link to="/Build" className="text-ink underline">
                  Be the first
                </Link>
                .
              </p>
            )}

            {browse.kind === "ready" && browse.items.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3">
                {browse.items.map((item) => (
                  <SubmissionCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <ShortsFooter />
    </div>
  );
}
