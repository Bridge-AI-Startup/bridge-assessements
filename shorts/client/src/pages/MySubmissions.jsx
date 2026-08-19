import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { fetchMySubmissions, linkCurrentAnonymousId } from "@/api/account";
import { useAuth } from "@/lib/useAuth";
import ShortsHeader from "@/components/ShortsHeader";
import ShortsFooter from "@/components/ShortsFooter";
import AccountModal from "@/components/AccountModal";
import SubmissionCard from "@/components/gallery/SubmissionCard";

export default function MySubmissions() {
  const { user, loading: authLoading, signedIn } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Make sure this browser's id is claimed before reading history, so a
        // first visit on a new device immediately shows builds made on it.
        await linkCurrentAnonymousId().catch(() => {});
        const result = await fetchMySubmissions();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, user?.uid]);

  // Group by round, newest first (server returns them in that order).
  const rounds = useMemo(() => {
    const bySlug = new Map();
    for (const s of data?.submissions || []) {
      const key = `${s.challengeDate}:${s.challengeSlug}`;
      if (!bySlug.has(key)) {
        bySlug.set(key, {
          key,
          challengeDate: s.challengeDate,
          challengeTitle: s.challengeTitle,
          items: [],
        });
      }
      bySlug.get(key).items.push(s);
    }
    return [...bySlug.values()];
  }, [data]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <ShortsHeader active="mybuilds" cta={{ label: "Build", to: "/Build" }} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium tracking-tight text-ink">
              My builds
            </h1>
            <p className="mt-1 text-sm text-fog-light">
              {signedIn ? (
                <>
                  Signed in as{" "}
                  <span className="font-medium text-ink">{user?.email}</span> —
                  every build linked to your account, across devices and rounds.
                </>
              ) : (
                <>Every build linked to your account, across devices and rounds.</>
              )}
            </p>
          </div>
          {signedIn && (
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="btn-pill-secondary"
            >
              Sign out
            </button>
          )}
        </div>

        {authLoading && (
          <p className="text-center text-sm text-fog-light">Loading…</p>
        )}

        {!authLoading && !signedIn && (
          <div className="punch-card px-4 py-10 text-center">
            <p className="text-[22px] font-medium tracking-tight text-ink">
              Sign in to see your builds
            </p>
            <p className="mt-2 text-sm text-fog-light">
              An account keeps your submissions across devices — even if this
              browser's data is cleared.
            </p>
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="btn-pill mt-4"
            >
              Sign in / create account
            </button>
          </div>
        )}

        {signedIn && loading && (
          <p className="text-center text-sm text-fog-light">
            Loading your builds…
          </p>
        )}
        {signedIn && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {signedIn && !loading && !error && rounds.length === 0 && (
          <div className="punch-card px-4 py-10 text-center">
            <p className="text-[22px] font-medium tracking-tight text-ink">
              No builds yet
            </p>
            <p className="mt-2 text-sm text-fog-light">
              <Link to="/Build" className="text-ink underline">
                Build this round's challenge
              </Link>{" "}
              and it will show up here.
            </p>
          </div>
        )}

        {rounds.map((round) => (
          <section key={round.key} className="mb-10">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-medium tracking-tight text-ink">
                {round.challengeTitle}
              </h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-fog-light">
                  {round.challengeDate}
                </span>
                <Link
                  to={`/Gallery?challengeDate=${round.challengeDate}`}
                  className="label-mono underline hover:text-ink"
                >
                  Rankings
                </Link>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {round.items.map((item) => (
                <SubmissionCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </main>

      <ShortsFooter />

      {showAccountModal && (
        <AccountModal onClose={() => setShowAccountModal(false)} />
      )}
    </div>
  );
}
