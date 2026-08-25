import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listSubmissions, deleteOwnSubmission, renameOwnSubmission } from "@/api/submissions";
import { listPastChallenges } from "@/api/challenges";
import { fetchStarredIds } from "@/api/stars";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import { useAuth } from "@/lib/useAuth";
import { fetchCurrentRound } from "@/lib/currentRound";
import ShortsHeader from "@/components/ShortsHeader";
import ShortsFooter from "@/components/ShortsFooter";
import SubmissionCard from "@/components/gallery/SubmissionCard";
import DeleteBuildModal from "@/components/DeleteBuildModal";
import RenameBuildModal from "@/components/RenameBuildModal";

export default function Gallery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDate = searchParams.get("challengeDate");
  const [currentRound, setCurrentRound] = useState(null);
  const [challengeDate, setChallengeDate] = useState(urlDate || "");
  const [items, setItems] = useState([]);
  const [mine, setMine] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // "builds" = one round's gallery; "rounds" = archive of past challenges.
  const [viewMode, setViewMode] = useState("builds");
  const [rounds, setRounds] = useState(null);
  const [roundsError, setRoundsError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [pendingRename, setPendingRename] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);
  const { user } = useAuth();
  const [starredIds, setStarredIds] = useState(() => new Set());

  // Which builds this person has saved — refetched on sign-in so the set
  // grows to include stars made on linked devices.
  useEffect(() => {
    let cancelled = false;
    fetchStarredIds()
      .then((ids) => {
        if (!cancelled) setStarredIds(ids);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  function onToggleStar(submissionId, starred) {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (starred) next.add(submissionId);
      else next.delete(submissionId);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchCurrentRound();
        if (cancelled) return;
        setCurrentRound(p);
        if (!urlDate) {
          setChallengeDate(p.challengeDate);
          if (!p.challengeDate) setLoading(false);
        }
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
        setMine(result.mine || []);
        setTotal(result.total || 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setItems([]);
          setMine([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challengeDate, anonymousId]);

  // Lazy-load the archive the first time the tab is opened.
  useEffect(() => {
    if (viewMode !== "rounds" || rounds !== null) return undefined;
    let cancelled = false;
    (async () => {
      setRoundsError(null);
      try {
        const result = await listPastChallenges({ limit: 100 });
        if (!cancelled) setRounds(result.challenges || []);
      } catch (err) {
        if (!cancelled) {
          setRoundsError(
            err instanceof Error ? err.message : "Failed to load rounds",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, rounds]);

  function onDateChange(value) {
    setChallengeDate(value);
    const currentKey = currentRound?.challengeDate;
    setSearchParams(
      currentKey && value === currentKey ? {} : { challengeDate: value },
    );
  }

  function openRound(round) {
    setViewMode("builds");
    onDateChange(round.challengeDate);
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteOwnSubmission(pendingDelete.id);
      setItems((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setMine((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setTotal((n) => Math.max(0, n - 1));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function applyRename(id, displayName) {
    const patch = (list) =>
      list.map((s) => (s.id === id ? { ...s, displayName } : s));
    setItems(patch);
    setMine(patch);
  }

  async function confirmRename(nextName) {
    if (!pendingRename || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const result = await renameOwnSubmission(pendingRename.id, nextName);
      applyRename(pendingRename.id, result.displayName);
      setPendingRename(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenaming(false);
    }
  }

  const possessive = "this round's";

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader
        active="browse"
        cta={{ label: "Start voting", to: "/Vote" }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium tracking-tight text-ink">
              Browse builds
            </h1>
            <p className="mt-1 text-sm text-fog-light">
              {viewMode === "rounds" ? (
                <>Every past challenge — open one to see its ranked builds</>
              ) : (
                <>
                  {total} build{total === 1 ? "" : "s"} for{" "}
                  <span className="font-mono">{challengeDate || "…"}</span>,
                  ranked by community votes — click a preview to open
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex rounded-xl border border-line p-1">
              {[
                { id: "builds", label: "This round" },
                { id: "rounds", label: "Past rounds" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewMode(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    viewMode === tab.id
                      ? "bg-mist font-medium text-ink"
                      : "text-fog-light hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {viewMode === "builds" && (
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
            )}
          </div>
        </div>

        {viewMode === "rounds" && (
          <>
            {roundsError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {roundsError}
              </div>
            )}
            {!roundsError && rounds === null && (
              <p className="text-center text-sm text-fog-light">
                Loading rounds…
              </p>
            )}
            {rounds !== null && rounds.length === 0 && (
              <div className="punch-card px-4 py-10 text-center">
                <p className="text-[22px] font-medium tracking-tight text-ink">
                  No past rounds yet
                </p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {(rounds || []).map((round) => (
                <div
                  key={round.slug}
                  className="punch-card-sm p-5 transition-transform duration-150 hover:-translate-y-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium text-ink">
                        {round.title}
                        {round.isCurrent ? (
                          <span className="ml-2 rounded-full bg-accent-blue/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent-blue">
                            live
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 font-mono text-xs text-fog-light">
                        {round.challengeDate} · {round.category} ·{" "}
                        {round.submissionCount} build
                        {round.submissionCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openRound(round)}
                      className="btn-pill-secondary"
                    >
                      View rankings
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {viewMode === "builds" && loading && (
          <p className="text-center text-sm text-fog-light">
            Loading submissions…
          </p>
        )}
        {viewMode === "builds" && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {viewMode === "builds" && !loading && !error && items.length === 0 && (
          <div className="punch-card px-4 py-10 text-center">
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

        {viewMode === "builds" && mine.length > 0 && (
          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-medium tracking-tight text-ink">
                Your submissions
              </h2>
              <span className="font-mono text-xs text-fog-light">
                {mine.length} build{mine.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((item) => (
                <SubmissionCard
                  key={item.id}
                  item={item}
                  starred={starredIds.has(item.id)}
                  onToggleStar={onToggleStar}
                  onRename={(build) => {
                    setRenameError(null);
                    setPendingRename(build);
                  }}
                  onDelete={(build) => {
                    setDeleteError(null);
                    setPendingDelete(build);
                  }}
                  renaming={renaming && pendingRename?.id === item.id}
                  deleting={deleting && pendingDelete?.id === item.id}
                />
              ))}
            </div>
          </section>
        )}

        {viewMode === "builds" && mine.length > 0 && !loading && items.length > 0 && (
          <h2 className="mb-3 text-[18px] font-medium tracking-tight text-ink">
            Rankings
          </h2>
        )}

        {viewMode === "builds" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <SubmissionCard
                key={item.id}
                item={item}
                starred={starredIds.has(item.id)}
                onToggleStar={onToggleStar}
              />
            ))}
          </div>
        )}
      </main>

      <ShortsFooter />

      {pendingDelete && (
        <DeleteBuildModal
          displayName={pendingDelete.displayName}
          deleting={deleting}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => {
            if (deleting) return;
            setPendingDelete(null);
            setDeleteError(null);
          }}
        />
      )}
      {pendingRename && (
        <RenameBuildModal
          displayName={pendingRename.displayName}
          renaming={renaming}
          error={renameError}
          onConfirm={(next) => void confirmRename(next)}
          onClose={() => {
            if (renaming) return;
            setPendingRename(null);
            setRenameError(null);
          }}
        />
      )}
    </div>
  );
}
