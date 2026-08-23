import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSavedBuilds } from "@/api/stars";
import { useAuth } from "@/lib/useAuth";
import ShortsHeader from "@/components/ShortsHeader";
import ShortsFooter from "@/components/ShortsFooter";
import SubmissionCard from "@/components/gallery/SubmissionCard";

/**
 * The saved-builds shelf: every build this person starred, newest star first,
 * across rounds. Works for guests off this browser's anonymousId; signing in
 * unions saves from linked devices (server-side, same as submissions).
 * Stars are private bookmarks — nobody else sees what's saved here.
 */
export default function Saved() {
  const { user, signedIn } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const result = await fetchSavedBuilds();
        if (!cancelled) setItems(result.submissions);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  function onToggleStar(submissionId, starred) {
    // Unstarring from here removes the card; a re-star mid-session is rare
    // enough that a refresh covering it is fine.
    if (!starred) {
      setItems((prev) =>
        prev ? prev.filter((s) => s.id !== submissionId) : prev,
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader
        active="saved"
        cta={{ label: "Browse builds", to: "/Gallery" }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-8">
          <h1 className="text-[28px] font-medium tracking-tight text-ink">
            Saved builds
          </h1>
          <p className="mt-1 text-sm text-fog-light">
            Builds you starred, newest first — only you can see this list.
            {!signedIn
              ? " Saves live in this browser; sign in to keep them across devices."
              : ""}
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!error && items === null && (
          <p className="text-center text-sm text-fog-light">Loading…</p>
        )}
        {items !== null && items.length === 0 && (
          <div className="punch-card px-4 py-10 text-center">
            <p className="text-[22px] font-medium tracking-tight text-ink">
              Nothing saved yet
            </p>
            <p className="mt-2 text-sm text-fog-light">
              Tap the star on any build in the{" "}
              <Link to="/Gallery" className="text-ink underline">
                gallery
              </Link>{" "}
              to keep it here.
            </p>
          </div>
        )}

        {items !== null && items.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <SubmissionCard
                key={item.id}
                item={item}
                starred
                onToggleStar={onToggleStar}
              />
            ))}
          </div>
        )}
      </main>

      <ShortsFooter />
    </div>
  );
}
