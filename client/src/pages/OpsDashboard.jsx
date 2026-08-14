import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { auth } from "@/firebase/firebase";
import { createPageUrl } from "@/utils";
import { fetchWhoami } from "@/api/user";
import { fetchOpsWorkload } from "@/api/ops";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatBytes(n) {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function signalLabel(signal) {
  return signal.replace(/_/g, " ");
}

function riskTone(score) {
  if (score >= 60) return "bg-red-100 text-red-900 border-red-200";
  if (score >= 40) return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-stone-100 text-stone-800 border-stone-200";
}

function StatusChip({ label, value }) {
  if (!value || value === "not_started") return null;
  const hot =
    value === "merging" ||
    value === "generating" ||
    value === "pending" ||
    value === "active";
  const bad = value === "failed";
  return (
    <Badge
      variant="outline"
      className={`font-normal ${
        hot
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : bad
            ? "border-red-300 bg-red-50 text-red-900"
            : "border-stone-200 bg-white text-stone-700"
      }`}
    >
      {label}: {value}
    </Badge>
  );
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="rounded-card border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-[0.03em] text-stone-500 font-mono">
        {label}
      </div>
      <div className="mt-1 text-2xl font-medium text-ink tabular-nums">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-stone-500">{hint}</div>
      ) : null}
    </div>
  );
}

function WorkloadRow({ item }) {
  const p = item.proctoring;
  return (
    <tr className="border-b border-stone-100 align-top hover:bg-stone-50/80">
      <td className="px-3 py-3 whitespace-nowrap">
        <div
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-medium tabular-nums ${riskTone(item.riskScore)}`}
        >
          {item.riskScore}
        </div>
        <div className="mt-1 text-xs text-stone-500">
          {formatTime(item.timestamps.activityAt)}
        </div>
      </td>
      <td className="px-3 py-3 min-w-[10rem]">
        <div className="font-medium text-ink text-sm">
          {item.employer.companyName || "—"}
        </div>
        <div className="text-xs text-stone-600 break-all">
          {item.employer.email || "—"}
        </div>
        {item.employer.userId ? (
          <div className="mt-0.5 font-mono text-[10px] text-stone-400">
            {item.employer.userId}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-[10rem]">
        <div className="text-sm text-ink">
          {item.assessment.title || "—"}
        </div>
        {item.assessment.id ? (
          <div className="mt-0.5 font-mono text-[10px] text-stone-400 break-all">
            {item.assessment.id}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-[10rem]">
        <div className="text-sm text-ink">
          {item.submission.candidateName || "—"}
        </div>
        <div className="text-xs text-stone-600 break-all">
          {item.submission.candidateEmail || "—"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <StatusChip label="sub" value={item.submission.status} />
          <StatusChip
            label="eval"
            value={item.submission.evaluationStatus}
          />
          <StatusChip
            label="beh"
            value={item.submission.behavioralGradingStatus}
          />
        </div>
        {item.submission.tokenTruncated ? (
          <div className="mt-1 font-mono text-[10px] text-stone-400">
            token {item.submission.tokenTruncated}
          </div>
        ) : null}
        {item.submission.id ? (
          <div className="font-mono text-[10px] text-stone-400 break-all">
            {item.submission.id}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 min-w-[14rem]">
        {p ? (
          <>
            <div className="flex flex-wrap gap-1 mb-2">
              <StatusChip label="session" value={p.status} />
              <StatusChip label="merge" value={p.mergedVideo.status} />
              <StatusChip label="transcript" value={p.transcript.status} />
              <StatusChip
                label="refined"
                value={p.transcript.refinedStatus}
              />
            </div>
            <div className="text-xs text-stone-600 space-y-0.5">
              <div>
                video {formatBytes(p.stats.totalVideoSizeBytes || p.mergedVideo.sizeBytes)}
                {" · "}
                {p.stats.totalChunks} chunks
                {" · "}
                {p.stats.totalFrames} frames
              </div>
              {p.mergedVideo.mergingStartedAt ? (
                <div>merge started {formatTime(p.mergedVideo.mergingStartedAt)}</div>
              ) : null}
              {p.transcript.status === "generating" &&
              p.transcript.progressTotalFrames != null ? (
                <div>
                  transcript {p.transcript.progressFramesProcessed ?? 0}/
                  {p.transcript.progressTotalFrames} frames
                </div>
              ) : null}
              {p.mergedVideo.error ? (
                <div className="text-red-700 truncate max-w-xs" title={p.mergedVideo.error}>
                  merge err: {p.mergedVideo.error}
                </div>
              ) : null}
              {p.transcript.error ? (
                <div className="text-red-700 truncate max-w-xs" title={p.transcript.error}>
                  transcript err: {p.transcript.error}
                </div>
              ) : null}
              <div className="font-mono text-[10px] text-stone-400">
                {p.sessionId}
              </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-stone-400">No proctoring session</span>
        )}
      </td>
      <td className="px-3 py-3 min-w-[9rem]">
        <div className="flex flex-wrap gap-1">
          {item.riskSignals.map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="font-normal text-[10px] border-stone-200 text-stone-700"
            >
              {signalLabel(s)}
            </Badge>
          ))}
        </div>
        {item.submission.behavioralGradingError ? (
          <div
            className="mt-1 text-xs text-red-700 truncate max-w-[12rem]"
            title={item.submission.behavioralGradingError}
          >
            {item.submission.behavioralGradingError}
          </div>
        ) : null}
        {item.submission.evaluationError ? (
          <div
            className="mt-1 text-xs text-red-700 truncate max-w-[12rem]"
            title={item.submission.evaluationError}
          >
            {item.submission.evaluationError}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export default function OpsDashboard() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchOpsWorkload({ hours, limit: 100 });
    if (result.success) {
      setData(result.data);
    } else {
      setError(result.error || "Failed to load workload");
      setData(null);
    }
    setLoading(false);
  }, [hours]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate(createPageUrl("Login"));
        return;
      }
      const whoami = await fetchWhoami();
      if (!whoami.success || !whoami.data?.opsAdmin) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
    });
    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (authorized) {
      load();
    }
  }, [authorized, load]);

  if (authorized === false) {
    return (
      <div className="min-h-screen bg-cream text-ink flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-700" />
          <h1 className="text-xl font-medium">Ops access required</h1>
          <p className="text-sm text-stone-600">
            This dashboard is gated to the OPS_ADMIN_EMAIL allowlist. Sign in
            with an allowed Bridge account.
          </p>
          <Button asChild variant="outline">
            <Link to={createPageUrl("Home")}>Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (authorized === null) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream text-ink">
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button asChild variant="ghost" size="sm" className="mt-0.5">
              <Link to={createPageUrl("Home")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Home
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                <h1 className="text-xl font-medium tracking-tight">
                  Ops workload
                </h1>
              </div>
              <p className="mt-1 text-sm text-stone-600 max-w-2xl">
                Who is driving heavy backend work (video merge, transcripts,
                behavioral grading). Risk signals only — not crash causes.
                Correlate times with Render logs.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value={6}>Last 6h</option>
              <option value={24}>Last 24h</option>
              <option value={72}>Last 72h</option>
              <option value={168}>Last 7d</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6 space-y-6">
        {data?.disclaimer ? (
          <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {data.disclaimer}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <SummaryCard label="High risk" value={data.summary.highRisk} />
              <SummaryCard
                label="Merging video"
                value={data.summary.mergingVideos}
              />
              <SummaryCard
                label="Transcripts"
                value={data.summary.generatingTranscripts}
              />
              <SummaryCard
                label="Behavioral"
                value={data.summary.pendingBehavioral}
              />
              <SummaryCard
                label="Evaluation"
                value={data.summary.pendingEvaluation}
              />
              <SummaryCard
                label="Active capture"
                value={data.summary.activeProctoring}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-card border border-stone-200 bg-white px-4 py-3 text-sm">
                <div className="text-xs uppercase tracking-[0.03em] text-stone-500 font-mono mb-1">
                  Video merge queue (this instance)
                </div>
                <div className="tabular-nums text-ink">
                  {data.queues.videoMerge.active} active ·{" "}
                  {data.queues.videoMerge.queued} queued · max{" "}
                  {data.queues.videoMerge.maxConcurrent}
                </div>
              </div>
              <div className="rounded-card border border-stone-200 bg-white px-4 py-3 text-sm">
                <div className="text-xs uppercase tracking-[0.03em] text-stone-500 font-mono mb-1">
                  Behavioral grading queue (this instance)
                </div>
                <div className="tabular-nums text-ink">
                  {data.queues.behavioralGrading.active} active ·{" "}
                  {data.queues.behavioralGrading.queued} queued · max{" "}
                  {data.queues.behavioralGrading.maxConcurrent}
                </div>
              </div>
            </div>
            <p className="text-xs text-stone-500">{data.queues.note}</p>
            <p className="text-xs text-stone-500">
              Snapshot {formatTime(data.generatedAt)} · window{" "}
              {data.windowHours}h · {data.summary.items} rows
            </p>

            <div className="rounded-card border border-stone-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 border-b border-stone-200 text-xs uppercase tracking-[0.03em] text-stone-500 font-mono">
                    <tr>
                      <th className="px-3 py-2 font-medium">Risk / time</th>
                      <th className="px-3 py-2 font-medium">Employer</th>
                      <th className="px-3 py-2 font-medium">Assessment</th>
                      <th className="px-3 py-2 font-medium">Submission</th>
                      <th className="px-3 py-2 font-medium">Proctoring</th>
                      <th className="px-3 py-2 font-medium">Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-10 text-center text-stone-500"
                        >
                          No heavy workload matched this window.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((item) => (
                        <WorkloadRow key={item.id} item={item} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-stone-500" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
