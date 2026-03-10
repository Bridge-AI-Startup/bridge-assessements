import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listStorageSessions,
  getSession,
  generateTranscript,
  getTranscriptContent,
  refineTranscript,
  getRefinedTranscriptContent,
  interpretTranscript,
  downloadProctoringVideo,
} from "@/api/proctoring";
import FrameDebugViewer from "@/components/proctoring/FrameDebugViewer";

/**
 * Dev-only test page to run the transcript pipeline (generate → refine → interpret)
 * on existing session data in storage/proctoring. No recording — pick a session
 * from disk and run the same script.
 */

const REGION_STYLES = {
  ai_chat: { bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700", label: "AI Chat" },
  terminal: { bg: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700", label: "Terminal" },
  editor: { bg: "bg-blue-50", border: "border-blue-200", badge: "bg-blue-100 text-blue-700", label: "Editor" },
  file_tree: { bg: "bg-purple-50", border: "border-purple-200", badge: "bg-purple-100 text-purple-700", label: "File Tree" },
  browser: { bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700", label: "Browser" },
};
const DEFAULT_STYLE = { bg: "bg-gray-50", border: "border-gray-200", badge: "bg-gray-100 text-gray-700", label: "Unknown" };

function TranscriptReadableView({ content }) {
  const segments = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (segments.length === 0) {
    return <p className="text-sm text-gray-400 italic">No transcript segments found.</p>;
  }

  const formatTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3 max-h-[600px] overflow-auto">
      {segments.map((seg, i) => {
        const style = REGION_STYLES[seg.region] || DEFAULT_STYLE;
        return (
          <div
            key={i}
            className={`rounded-lg border ${style.border} ${style.bg} p-3`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${style.badge}`}>
                {style.label}
              </span>
              {seg.app && seg.app !== style.label && (
                <span className="text-[10px] text-gray-500">{seg.app}</span>
              )}
              <span className="text-[10px] text-gray-400 font-mono ml-auto">
                {formatTime(seg.ts)}
                {seg.ts_end && seg.ts_end !== seg.ts && ` — ${formatTime(seg.ts_end)}`}
              </span>
            </div>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono leading-relaxed">
              {seg.text_content || seg.text || "(empty)"}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function RefinedTranscriptView({ content }) {
  const segments = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ta = typeof a.ts === "number" ? a.ts : new Date(a.ts).getTime();
      const tb = typeof b.ts === "number" ? b.ts : new Date(b.ts).getTime();
      return ta - tb;
    });

  if (segments.length === 0) {
    return <p className="text-sm text-gray-400 italic">No refined segments found.</p>;
  }

  const formatTime = (val) => {
    if (val === undefined || val === null) return "";
    if (typeof val === "number") {
      const mins = Math.floor(val / 60);
      const secs = Math.floor(val % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    try {
      return new Date(val).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return String(val);
    }
  };

  return (
    <div className="space-y-2 max-h-[600px] overflow-auto">
      {segments.map((seg, i) => (
        <div
          key={i}
          className="flex gap-3 py-2 border-b border-gray-100 last:border-0"
        >
          <div className="flex-shrink-0 text-[11px] font-mono text-gray-400 pt-0.5 w-24 text-right">
            {formatTime(seg.ts)}
            {seg.ts_end != null && seg.ts_end !== seg.ts && (
              <span className="text-gray-300"> — {formatTime(seg.ts_end)}</span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {seg.description || "(empty)"}
          </p>
        </div>
      ))}
    </div>
  );
}

function EnrichedTranscriptView({ result, strategyLabel }) {
  if (!result) return null;
  const { events, session_narrative, processing_stats } = result;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="font-medium text-gray-700">{strategyLabel}</span>
        <span className="font-mono">
          {processing_stats.llm_calls} calls · {processing_stats.processing_time_ms}ms
        </span>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-auto">
        {events.map((e, i) => (
          <div
            key={i}
            className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-sm"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-gray-500">
                [{e.ts}s – {e.ts_end}s]
              </span>
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {e.intent}
              </span>
            </div>
            <p className="text-gray-700 leading-relaxed">{e.behavioral_summary}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium text-gray-500 mb-1">Session narrative</p>
        <p className="text-sm text-gray-700 leading-relaxed">{session_narrative}</p>
      </div>
    </div>
  );
}

export default function ProctoringStorageTest() {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState(null);
  const [generatingElapsedSeconds, setGeneratingElapsedSeconds] = useState(0);
  const [transcriptContent, setTranscriptContent] = useState(null);
  const [transcriptView, setTranscriptView] = useState("readable");
  const [refineStatus, setRefineStatus] = useState(null);
  const [refinedContent, setRefinedContent] = useState(null);
  const [interpretStatus, setInterpretStatus] = useState(null);
  const [chunkedResult, setChunkedResult] = useState(null);
  const [statefulResult, setStatefulResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionsLoading(true);
      const result = await listStorageSessions();
      if (cancelled) return;
      if (result.success) {
        setSessions(result.data.sessions || []);
      } else {
        setError(result.error || "Failed to list storage sessions");
      }
      setSessionsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Elapsed timer while transcript is generating
  useEffect(() => {
    if (transcriptStatus !== "generating") {
      setGeneratingElapsedSeconds(0);
      return;
    }
    const t = setInterval(() => setGeneratingElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [transcriptStatus]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionData(null);
      setTranscriptStatus(null);
      setTranscriptContent(null);
      setRefineStatus(null);
      setRefinedContent(null);
      setInterpretStatus(null);
      setChunkedResult(null);
      setStatefulResult(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await getSession(selectedSessionId);
      if (cancelled) return;
      if (result.success) {
        setSessionData(result.data);
        setTranscriptStatus(result.data.transcript?.status || null);
        setRefineStatus(result.data.transcript?.refinedStatus || null);
        if (result.data.transcript?.status === "completed") {
          const tr = await getTranscriptContent(selectedSessionId);
          if (tr.success) setTranscriptContent(tr.data);
        }
        if (result.data.transcript?.refinedStatus === "completed") {
          const rf = await getRefinedTranscriptContent(selectedSessionId);
          if (rf.success) setRefinedContent(rf.data);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);
  const canRunPipeline = selectedSession?.inDb === true;

  const runGenerateTranscript = async () => {
    if (!selectedSessionId) return;
    const result = await generateTranscript(selectedSessionId);
    if (!result.success) {
      setTranscriptStatus("failed");
      setError(result.error || "Transcript generation failed");
      return;
    }
    const poll = setInterval(async () => {
      const sessionResult = await getSession(selectedSessionId);
      if (sessionResult.success) {
        setSessionData(sessionResult.data);
        const status = sessionResult.data.transcript?.status;
        if (status === "completed") {
          clearInterval(poll);
          setTranscriptStatus("completed");
          const transcriptResult = await getTranscriptContent(selectedSessionId);
          if (transcriptResult.success) setTranscriptContent(transcriptResult.data);
        } else if (status === "failed") {
          clearInterval(poll);
          setTranscriptStatus("failed");
          setError(sessionResult.data.transcript?.error || "Transcript generation failed");
        }
      }
    }, 3000);
  };

  const handleGenerateTranscript = async () => {
    if (!selectedSessionId) return;
    setTranscriptStatus("generating");
    setGeneratingElapsedSeconds(0);
    setError(null);
    await runGenerateTranscript();
  };

  const handleRegenerateFromScratch = async () => {
    if (!selectedSessionId) return;
    setError(null);
    setTranscriptStatus("generating");
    setGeneratingElapsedSeconds(0);
    setTranscriptContent(null);
    setRefineStatus(null);
    setRefinedContent(null);
    setInterpretStatus(null);
    setChunkedResult(null);
    setStatefulResult(null);
    await runGenerateTranscript();
  };

  const handleRefineTranscript = async (sessionIdOverride) => {
    const sid = sessionIdOverride ?? selectedSessionId;
    if (!sid) return;
    if (!sessionIdOverride) {
      setRefineStatus("generating");
    } else {
      setSelectedSessionId(sid);
      setRefineStatus("generating");
    }
    setError(null);
    const result = await refineTranscript(sid);
    if (!result.success) {
      setRefineStatus("failed");
      setError(result.error || "Transcript refinement failed");
      return;
    }
    const poll = setInterval(async () => {
      const sessionResult = await getSession(sid);
      if (sessionResult.success) {
        setSessionData(sessionResult.data);
        const status = sessionResult.data.transcript?.refinedStatus;
        if (status === "completed") {
          clearInterval(poll);
          setRefineStatus("completed");
          const refinedResult = await getRefinedTranscriptContent(sid);
          if (refinedResult.success) setRefinedContent(refinedResult.data);
        } else if (status === "failed") {
          clearInterval(poll);
          setRefineStatus("failed");
          setError(sessionResult.data.transcript?.refinedError || "Refinement failed");
        }
      }
    }, 3000);
  };

  const handleInterpretTranscript = async () => {
    if (!selectedSessionId) return;
    setInterpretStatus("loading");
    setError(null);
    const result = await interpretTranscript(selectedSessionId);
    if (!result.success) {
      setInterpretStatus("failed");
      setError(result.error || "Activity interpretation failed");
      return;
    }
    setChunkedResult(result.data.chunked);
    setStatefulResult(result.data.stateful);
    setInterpretStatus("done");
  };

  const handleRefreshList = async () => {
    setSessionsLoading(true);
    const result = await listStorageSessions();
    if (result.success) setSessions(result.data.sessions || []);
    setSessionsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
            <FolderOpen className="w-6 h-6 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Proctoring Storage Test
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Run generate → refine → interpret on existing sessions in storage/proctoring
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 bg-yellow-50 text-yellow-700 text-xs px-2.5 py-1 rounded-full border border-yellow-200">
            <AlertCircle className="w-3 h-3" />
            Development only — disabled in production
          </div>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              Dismiss
            </button>
          </div>
        )}

        {/* List storage sessions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Sessions in storage/proctoring
            </h2>
            <Button variant="outline" size="sm" onClick={handleRefreshList} disabled={sessionsLoading}>
              {sessionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
            </Button>
          </div>
          {sessionsLoading ? (
            <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No session directories found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-2 pr-2">Session ID</th>
                    <th className="pb-2 pr-2">Frames</th>
                    <th className="pb-2 pr-2">Videos</th>
                    <th className="pb-2 pr-2">In DB</th>
                    <th className="pb-2 pr-2">Transcript</th>
                    <th className="pb-2 pr-2">Refined</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.sessionId}
                      className={`border-b border-gray-100 ${
                        selectedSessionId === s.sessionId ? "bg-indigo-50/50" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{s.sessionId}</td>
                      <td className="py-2 pr-2">{s.frameCount}</td>
                      <td className="py-2 pr-2">{s.videoCount}</td>
                      <td className="py-2 pr-2">
                        {s.inDb ? (
                          <span className="text-green-600">Yes</span>
                        ) : (
                          <span className="text-amber-600">No</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-gray-600">{s.transcriptStatus || "—"}</td>
                      <td className="py-2 pr-2 text-gray-600">{s.refinedStatus || "—"}</td>
                      <td className="py-2 flex items-center gap-1">
                        {s.inDb && s.transcriptStatus === "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-violet-600 border-violet-200 hover:bg-violet-50"
                            onClick={() => handleRefineTranscript(s.sessionId)}
                          >
                            <Sparkles className="w-3 h-3 mr-1" />
                            Refine
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={selectedSessionId === s.sessionId ? "default" : "outline"}
                          onClick={() => setSelectedSessionId(s.sessionId)}
                        >
                          {selectedSessionId === s.sessionId ? "Selected" : "Select"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!canRunPipeline && selectedSessionId && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            This session is not in the database. Generate / Refine / Interpret require a
            ProctoringSession record in MongoDB. Only sessions with “In DB: Yes” can run the pipeline.
          </div>
        )}

        {canRunPipeline && selectedSessionId && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Session</h2>
                </div>
                {(selectedSession?.videoCount ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const result = await downloadProctoringVideo(selectedSessionId);
                      if (!result.success) setError(result.error || "Video download failed");
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download video
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Session ID:</span>{" "}<span className="font-mono text-xs">{selectedSessionId}</span></div>
                <div><span className="text-gray-500">Frames (storage):</span>{" "}<span className="font-mono">{selectedSession?.frameCount ?? 0}</span></div>
                <div><span className="text-gray-500">Videos (storage):</span>{" "}<span className="font-mono">{selectedSession?.videoCount ?? 0}</span></div>
                {sessionData?.stats && (
                  <>
                    <div><span className="text-gray-500">Total Frames (DB):</span>{" "}<span className="font-mono">{sessionData.stats.totalFrames ?? 0}</span></div>
                    <div><span className="text-gray-500">Unique Frames:</span>{" "}<span className="font-mono">{sessionData.stats.uniqueFrames ?? 0}</span></div>
                  </>
                )}
              </div>
            </div>

            {/* Raw transcript */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Raw Transcript</h2>
                <span className="text-xs text-gray-400 font-normal">(VLM output)</span>
              </div>
              {!transcriptStatus && (
                <div>
                  <p className="text-sm text-gray-500 mb-4">
                    Generate an AI transcript from stored frames/video using GPT-4o vision.
                  </p>
                  <Button onClick={handleGenerateTranscript} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Transcript
                  </Button>
                </div>
              )}
              {transcriptStatus === "generating" && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 text-blue-700 min-w-0 flex-1">
                      <Loader2 className="w-6 h-6 animate-spin shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Generating transcript</p>
                        <p className="text-sm text-blue-600 mt-0.5">
                          The server is processing frames with AI vision. This can take several minutes for long sessions.
                        </p>
                        {(sessionData?.transcript?.progressTotalFrames != null && sessionData?.transcript?.progressTotalFrames > 0) ? (
                          <>
                            <p className="text-sm font-medium text-blue-700 mt-2">
                              Frame {sessionData.transcript.progressFramesProcessed ?? 0} of {sessionData.transcript.progressTotalFrames}
                              {sessionData.transcript.progressTotalBatches != null && sessionData.transcript.progressTotalBatches > 0 && (
                                <span className="text-blue-600 font-normal ml-2">
                                  (batch {Math.min((sessionData.transcript.progressBatchIndex ?? 0) + 1, sessionData.transcript.progressTotalBatches)} of {sessionData.transcript.progressTotalBatches})
                                </span>
                              )}
                            </p>
                            <div className="mt-2 h-2 rounded-full bg-blue-200 overflow-hidden">
                              <div
                                className="h-full bg-blue-600 rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.min(100, (100 * (sessionData.transcript.progressFramesProcessed ?? 0)) / sessionData.transcript.progressTotalFrames)}%`,
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-blue-500 mt-2 font-mono">Preparing…</p>
                        )}
                        <p className="text-xs text-blue-500 mt-2 font-mono">
                          Elapsed: {Math.floor(generatingElapsedSeconds / 60)}:{String(generatingElapsedSeconds % 60).padStart(2, "0")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRegenerateFromScratch}
                      className="text-amber-700 border-amber-200 hover:bg-amber-50 shrink-0"
                    >
                      Regenerate from scratch
                    </Button>
                  </div>
                </div>
              )}
              {transcriptStatus === "completed" && transcriptContent && (
                <div>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">Transcript generated successfully</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateFromScratch}
                        className="text-amber-700 border-amber-200 hover:bg-amber-50"
                      >
                        Regenerate from scratch
                      </Button>
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs">
                      <button
                        onClick={() => setTranscriptView("readable")}
                        className={`px-2.5 py-1 rounded-md ${transcriptView === "readable" ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        Readable
                      </button>
                      <button
                        onClick={() => setTranscriptView("raw")}
                        className={`px-2.5 py-1 rounded-md ${transcriptView === "raw" ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        Raw JSON
                      </button>
                    </div>
                    </div>
                  </div>
                  {transcriptView === "raw" ? (
                    <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-auto max-h-96 font-mono">
                      {transcriptContent.split("\n").filter(Boolean).map((line) => {
                        try {
                          return JSON.stringify(JSON.parse(line), null, 2);
                        } catch {
                          return line;
                        }
                      }).join("\n\n")}
                    </pre>
                  ) : (
                    <TranscriptReadableView content={transcriptContent} />
                  )}
                </div>
              )}
              {transcriptStatus === "failed" && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">Transcript generation failed. Check server logs.</span>
                </div>
              )}
            </div>

            {transcriptStatus === "completed" && (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-violet-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Refined Transcript</h2>
                  </div>
                  {!refineStatus && (
                    <div>
                      <p className="text-sm text-gray-500 mb-4">
                        Process the raw OCR transcript through GPT-4o to clean up artifacts and produce human-readable descriptions.
                      </p>
                      <Button onClick={handleRefineTranscript} className="bg-violet-600 hover:bg-violet-700 text-white">
                        <Sparkles className="w-4 h-4 mr-2" />
                        Refine Transcript
                      </Button>
                    </div>
                  )}
                  {refineStatus === "generating" && (
                    <div className="flex items-center gap-3 text-violet-600">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Refining transcript... This may take a minute.</span>
                    </div>
                  )}
                  {refineStatus === "completed" && refinedContent && (
                    <div>
                      <div className="flex items-center gap-2 text-green-600 mb-3">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Transcript refined successfully</span>
                      </div>
                      <RefinedTranscriptView content={refinedContent} />
                    </div>
                  )}
                  {refineStatus === "failed" && (
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">Refinement failed. Check server logs.</span>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Activity Interpreter</h2>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">
                    Run both processing strategies (Chunked and Stateful) on the raw transcript.
                  </p>
                  {!interpretStatus && (
                    <Button onClick={handleInterpretTranscript} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Run both strategies (Chunked & Stateful)
                    </Button>
                  )}
                  {interpretStatus === "loading" && (
                    <div className="flex items-center gap-3 text-indigo-600">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Running both strategies... This may take a minute.</span>
                    </div>
                  )}
                  {interpretStatus === "done" && (chunkedResult || statefulResult) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                      <div className="rounded-lg border border-gray-200 p-4 bg-blue-50/30">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Processed (Chunked)</h3>
                        <EnrichedTranscriptView result={chunkedResult} strategyLabel="LLM-Chunked" />
                      </div>
                      <div className="rounded-lg border border-gray-200 p-4 bg-emerald-50/30">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Processed (Stateful)</h3>
                        <EnrichedTranscriptView result={statefulResult} strategyLabel="Stateful-Sequential" />
                      </div>
                    </div>
                  )}
                  {interpretStatus === "failed" && (
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">Activity interpretation failed. Check server logs.</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <FrameDebugViewer sessionId={selectedSessionId} />

            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedSessionId(null);
                  setSessionData(null);
                  setTranscriptStatus(null);
                  setTranscriptContent(null);
                  setRefineStatus(null);
                  setRefinedContent(null);
                  setInterpretStatus(null);
                  setChunkedResult(null);
                  setStatefulResult(null);
                  setError(null);
                }}
              >
                Clear selection
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
