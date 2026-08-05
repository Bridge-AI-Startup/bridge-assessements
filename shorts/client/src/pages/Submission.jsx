import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSubmission } from "@/api/submissions";
import { shouldFetchSubmissionFiles } from "@/config/submissionPreview";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";
import { getOrCreateAnonymousId } from "@/lib/anonymousId";
import ShortsHeader from "@/components/ShortsHeader";
import ShareBuild from "@/components/ShareBuild";

export default function Submission() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const anonymousId = useMemo(() => getOrCreateAnonymousId(), []);

  useEffect(() => {
    if (!id) {
      setError("missing id");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getSubmission(id, {
          anonymousId,
          includeFiles: shouldFetchSubmissionFiles,
        });
        if (!cancelled) setDetail(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, anonymousId]);

  const preview = useSubmissionPreview({
    submissionId: detail?.id,
    previewRevision: detail?.previewRevision ?? detail?.submittedAt,
    files: detail?.files,
  });

  const cta =
    detail && !detail.isMine
      ? {
          label: "Compare in Vote",
          to: `/Vote?preferId=${detail.id}&challengeDate=${detail.challengeDate}`,
        }
      : null;

  return (
    <div className="min-h-screen bg-paper">
      <ShortsHeader active="browse" cta={cta} />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link to="/Gallery" className="label-mono hover:text-ink">
          ← Browse
        </Link>

        {loading && (
          <p className="mt-8 text-sm text-fog-light">Loading…</p>
        )}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error === "not_found" ? "Submission not found" : error}
          </div>
        )}
        {detail && (
          <>
            <div className="mb-6 mt-6 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[28px] font-medium tracking-tight text-ink">
                  {detail.displayName}
                  {detail.isMine ? (
                    <span className="ml-2 rounded-full bg-accent-blue/10 px-2 py-0.5 font-mono text-[10px] uppercase text-accent-blue">
                      you
                    </span>
                  ) : null}
                </h1>
                <p className="mt-2 font-mono text-sm text-fog-light">
                  Rank #{detail.rank ?? "—"} · score {detail.score} ·{" "}
                  {detail.wins}-{detail.losses} ({detail.matches} matches)
                  {detail.provisional ? " · provisional" : ""}
                </p>
                <p className="mt-1 text-xs text-fog-light">
                  Preview shows{" "}
                  <code className="rounded bg-mist px-1 font-mono">
                    index.html
                  </code>
                </p>
              </div>
              <ShareBuild
                submissionId={detail.id}
                displayName={detail.displayName}
                isMine={detail.isMine}
                className="shrink-0"
              />
            </div>

            <div className="rounded-2xl border border-line bg-cream p-2 shadow-card">
              <div className="overflow-hidden rounded-xl border border-line bg-paper">
                {preview?.url ? (
                  <iframe
                    title="Submission preview"
                    src={preview.url}
                    className="h-[70vh] w-full bg-paper"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                  />
                ) : (
                  <div className="px-4 py-16 text-center text-sm text-fog-light">
                    No{" "}
                    <code className="rounded bg-mist px-1 font-mono">
                      index.html
                    </code>{" "}
                    found to preview.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
