import { useEffect, useState } from "react";
import { authDelete, authGet, readJsonBody } from "@/api/requests";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";
import { fetchCurrentRound } from "@/lib/currentRound";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminSubmissions() {
  const [challengeDate, setChallengeDate] = useState("");
  const [roundReady, setRoundReady] = useState(false);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState(null);
  /** Two-step delete: arm on first click, act on the second. */
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchCurrentRound();
        if (cancelled) return;
        setChallengeDate(p.challengeDate);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load current round",
          );
        }
      } finally {
        if (!cancelled) setRoundReady(true);
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
    setConfirmDeleteId(null);
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

  async function handleDelete(id) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await authDelete(`/admin/submissions/${id}`);
      const body = await readJsonBody(res);
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
        );
      }
      const votes = Number(body.votesRemoved) || 0;
      setNotice(
        `Deleted "${body.displayName || "build"}"${
          votes ? ` and ${votes} vote${votes === 1 ? "" : "s"}` : ""
        }.`,
      );
      setConfirmDeleteId(null);
      setSelectedId(null);
      setDetail(null);
      await loadList(challengeDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

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
            disabled={!roundReady}
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

      {notice && (
        <p className="mt-3 text-sm text-fog">{notice}</p>
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
              <div className="flex items-start justify-between gap-3 border-b border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{detail.displayName}</p>
                  <p className="text-xs text-fog-light">
                    #{detail.challengeSlug} · {detail.challengeDate}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {confirmDeleteId === detail.id ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deleting}
                      className="rounded border border-line bg-paper px-2 py-1 text-xs text-fog hover:bg-mist disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(detail.id)}
                    disabled={deleting}
                    className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${
                      confirmDeleteId === detail.id
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "border border-red-200 text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {deleting
                      ? "Deleting…"
                      : confirmDeleteId === detail.id
                        ? "Confirm delete"
                        : "Delete"}
                  </button>
                </div>
              </div>
              {confirmDeleteId === detail.id ? (
                <p className="border-b border-line bg-red-50 px-3 py-2 text-xs text-red-700">
                  Permanently deletes this build and its head-to-head votes.
                  Opponents keep the rating they already won from it.
                </p>
              ) : null}

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
