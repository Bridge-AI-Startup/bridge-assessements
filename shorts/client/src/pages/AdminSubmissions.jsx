import { useEffect, useState } from "react";
import { authGet } from "@/api/requests";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";
import { fetchChallengePeriod } from "@/lib/challengePeriod";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminSubmissions() {
  const [challengeDate, setChallengeDate] = useState("");
  const [periodReady, setPeriodReady] = useState(false);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchChallengePeriod();
        if (cancelled) return;
        setChallengeDate(p.periodKey);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load period",
          );
        }
      } finally {
        if (!cancelled) setPeriodReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadList(date) {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      qs.set("challengeDate", date);
      const res = await authGet(`/admin/submissions?${qs}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      setList(body.submissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (challengeDate) loadList(challengeDate);
  }, [challengeDate]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSelectedPath(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await authGet(`/admin/submissions/${selectedId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        setDetail(body);
        const paths = (body.files || []).map((f) => f.path);
        setSelectedPath(
          paths.find((p) => p === "index.html") || paths[0] || null,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load detail");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const preview = useSubmissionPreview({
    submissionId: detail?.id,
    previewRevision: detail?.previewRevision ?? detail?.submittedAt,
    files: detail?.files,
  });

  const selectedFile = detail?.files?.find((f) => f.path === selectedPath);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-fog">
          Challenge date
          <input
            type="date"
            value={challengeDate}
            onChange={(e) => {
              setSelectedId(null);
              setChallengeDate(e.target.value);
            }}
            disabled={!periodReady}
            className="mt-1 block rounded border border-line px-3 py-1.5 text-sm disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => loadList(challengeDate)}
          disabled={!challengeDate}
          className="rounded border border-line bg-paper px-3 py-1.5 text-sm text-fog hover:bg-paper disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-paper">
          <div className="border-b border-line px-3 py-2 text-sm font-medium text-fog">
            Submissions {loading ? "(loading…)" : `(${list.length})`}
          </div>
          {list.length === 0 && !loading ? (
            <p className="px-3 py-6 text-center text-sm text-fog-light">
              No submissions for this date.
            </p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full px-3 py-2.5 text-left text-sm hover:bg-paper ${
                      selectedId === s.id ? "bg-mist" : ""
                    }`}
                  >
                    <div className="font-medium text-ink">
                      {s.displayName}
                    </div>
                    <div className="mt-0.5 text-xs text-fog-light">
                      #{s.challengeSlug} · {s.fileCount} files ·{" "}
                      {formatBytes(s.totalBytes)} ·{" "}
                      {new Date(s.submittedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-paper">
          {!selectedId && (
            <p className="px-3 py-10 text-center text-sm text-fog-light">
              Select a submission to inspect files and preview.
            </p>
          )}
          {selectedId && detailLoading && (
            <p className="px-3 py-10 text-center text-sm text-fog-light">
              Loading…
            </p>
          )}
          {selectedId && detail && !detailLoading && (
            <div className="flex flex-col">
              <div className="border-b border-line px-3 py-2">
                <p className="font-medium text-ink">{detail.displayName}</p>
                <p className="text-xs text-fog-light">
                  #{detail.challengeSlug} · {detail.challengeDate}
                </p>
              </div>

              <div className="grid min-h-[20rem] grid-cols-1 border-b border-line md:grid-cols-2">
                <div className="border-b border-line md:border-b-0 md:border-r">
                  <p className="bg-paper px-2 py-1 text-xs font-medium uppercase tracking-wide text-fog-light">
                    Files
                  </p>
                  <ul className="max-h-40 overflow-y-auto text-sm">
                    {(detail.files || []).map((f) => (
                      <li key={f.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedPath(f.path)}
                          className={`w-full truncate px-2 py-1 text-left font-mono text-xs hover:bg-paper ${
                            selectedPath === f.path
                              ? "bg-mist text-ink"
                              : "text-fog"
                          }`}
                        >
                          {f.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-h-[10rem]">
                  <p className="bg-paper px-2 py-1 text-xs font-medium uppercase tracking-wide text-fog-light">
                    {selectedPath || "Content"}
                  </p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap p-2 font-mono text-xs text-ink">
                    {selectedFile?.content ?? "(empty)"}
                  </pre>
                </div>
              </div>

              <div>
                <p className="bg-paper px-2 py-1 text-xs font-medium uppercase tracking-wide text-fog-light">
                  Preview
                </p>
                {preview?.url ? (
                  <iframe
                    title="Submission preview"
                    src={preview.url}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                    className="h-64 w-full border-0 bg-paper"
                  />
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-fog-light">
                    No HTML entry file to preview.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
