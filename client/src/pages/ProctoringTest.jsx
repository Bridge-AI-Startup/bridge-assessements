import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Monitor,
  Play,
  Square,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ConsentScreen from "@/components/proctoring/ConsentScreen";
import RecordingIndicator from "@/components/proctoring/RecordingIndicator";
import StreamStatusPanel from "@/components/proctoring/StreamStatusPanel";
import ResharePrompt from "@/components/proctoring/ResharePrompt";
import useScreenCapture from "@/hooks/useScreenCapture";
import useScreenshotCapture from "@/hooks/useScreenshotCapture";
import useFrameDedup from "@/hooks/useFrameDedup";
import useFrameUpload from "@/hooks/useFrameUpload";
import useVideoRecording from "@/hooks/useVideoRecording";
import FrameDebugViewer from "@/components/proctoring/FrameDebugViewer";
import ProctoringCompanionNotch from "@/components/proctoring/ProctoringCompanionNotch";
import {
  createTestProctoringSession,
  grantConsent,
  completeSession,
  getSession,
  generateTranscript,
  getTranscriptContent,
  getCompanionTranscript,
  interpretTranscript,
  recordSidecarEvents,
} from "@/api/proctoring";

/**
 * Standalone test page for the proctoring/screen capture feature.
 * Bypasses the normal assessment flow so you can test recording + transcription directly.
 *
 * DEV ONLY — the server endpoint returns 404 in production.
 *
 * To remove this test page and all related test infrastructure, run:
 *   node scripts/remove-proctoring-test.js
 * from the project root (see PROCTORING_TEST_TEARDOWN.md for details).
 */

const PHASE = {
  SETUP: "setup",
  CONSENT: "consent",
  RECORDING: "recording",
  COMPLETED: "completed",
};

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

function EnrichedTranscriptView({ result, strategyLabel }) {
  if (!result) return null;
  const { events, session_narrative, strategy, processing_stats } = result;
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

export default function ProctoringTest() {
  const [phase, setPhase] = useState(PHASE.SETUP);
  const [sessionId, setSessionId] = useState(null);
  const [token, setToken] = useState(null);
  const [submissionId, setSubmissionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState(null);
  const [transcriptContent, setTranscriptContent] = useState(null);
  const [transcriptView, setTranscriptView] = useState("readable"); // "readable" or "raw"
  const [interpretStatus, setInterpretStatus] = useState(null); // "loading" | "done" | "failed"
  const [chunkedResult, setChunkedResult] = useState(null);
  const [statefulResult, setStatefulResult] = useState(null);
  const [showResharePrompt, setShowResharePrompt] = useState(false);
  const [companionTranscript, setCompanionTranscript] = useState(null);
  const [companionTranscriptLoading, setCompanionTranscriptLoading] = useState(false);
  const sidecarBufferRef = useRef([]);
  const companionRef = useRef(null);

  // Proctoring hooks
  const {
    streams,
    isSharing,
    startCapture,
    stopCapture,
    streamLost,
    onStreamLost,
    onStreamRestored,
  } = useScreenCapture();

  const { consumeFrames, frameCount } = useScreenshotCapture(streams, {
    intervalMs: 15000, // Screenshots are fallback — video is primary
    enabled: phase === PHASE.RECORDING && isSharing,
  });

  // Video recording (primary capture method)
  const {
    isRecording: isVideoRecording,
    chunkCount: videoChunkCount,
    uploadedChunks: videoUploadedChunks,
    failedChunks: videoFailedChunks,
    totalVideoBytes,
    videoFailed,
    stopRecording: stopVideoRecording,
  } = useVideoRecording(streams, {
    sessionId,
    token,
    enabled: phase === PHASE.RECORDING && isSharing,
  });

  const { shouldKeepFrame, duplicatesSkipped } = useFrameDedup();

  // Wrap consumeFrames with dedup
  const consumeDedupedFrames = useCallback(async () => {
    const raw = consumeFrames();
    const kept = [];
    for (const frame of raw) {
      const keep = await shouldKeepFrame(frame.blob, frame.screenIndex);
      if (keep) kept.push(frame);
    }
    return kept;
  }, [consumeFrames, shouldKeepFrame]);

  // Use a ref wrapper so useFrameUpload gets a sync function
  const dedupedQueueRef = useRef([]);
  useEffect(() => {
    if (phase !== PHASE.RECORDING || !isSharing) return;
    const interval = setInterval(async () => {
      const frames = await consumeDedupedFrames();
      dedupedQueueRef.current.push(...frames);
    }, 4000); // slightly faster than upload interval
    return () => clearInterval(interval);
  }, [phase, isSharing, consumeDedupedFrames]);

  const consumeFromDedupQueue = useCallback(() => {
    const frames = [...dedupedQueueRef.current];
    dedupedQueueRef.current = [];
    return frames;
  }, []);

  const { uploadedCount, failedCount, isUploading, flush } = useFrameUpload({
    sessionId,
    token,
    consumeFrames: consumeFromDedupQueue,
    enabled: phase === PHASE.RECORDING && isSharing,
  });

  // Stream lost/restored handlers
  useEffect(() => {
    onStreamLost(() => {
      setShowResharePrompt(true);
      sidecarBufferRef.current.push({
        type: "stream_lost",
        timestamp: Date.now(),
      });
    });
    onStreamRestored(() => {
      setShowResharePrompt(false);
      sidecarBufferRef.current.push({
        type: "stream_restored",
        timestamp: Date.now(),
      });
    });
  }, [onStreamLost, onStreamRestored]);

  // Sidecar events flush
  useEffect(() => {
    if (phase !== PHASE.RECORDING || !sessionId || !token) return;
    const interval = setInterval(async () => {
      if (sidecarBufferRef.current.length === 0) return;
      const events = [...sidecarBufferRef.current];
      sidecarBufferRef.current = [];
      await recordSidecarEvents(sessionId, token, events);
    }, 10000);
    return () => clearInterval(interval);
  }, [phase, sessionId, token]);

  // --- Phase handlers ---

  const handleCreateSession = async () => {
    setLoading(true);
    setError(null);
    const result = await createTestProctoringSession();
    if (result.success) {
      setSessionId(result.data.session._id);
      setToken(result.data.token);
      setSubmissionId(result.data.session.submissionId ?? null);
      setPhase(PHASE.CONSENT);
    } else {
      setError(result.error || "Failed to create test session");
    }
    setLoading(false);
  };

  const handleConsent = async () => {
    setLoading(true);
    const stream = await startCapture();
    if (!stream) {
      setError("Screen share was denied");
      setLoading(false);
      return;
    }
    await grantConsent(sessionId, token, 1);
    setPhase(PHASE.RECORDING);
    setLoading(false);
  };

  const handleDecline = () => {
    setError("Recording declined. You need to consent to test proctoring.");
  };

  const handleStopRecording = async () => {
    setLoading(true);
    // End companion (flush transcript) first
    if (companionRef.current?.endAndFlush) {
      await companionRef.current.endAndFlush();
    }
    // Stop video recording (flushes final chunk)
    await stopVideoRecording();
    // Final screenshot flush
    await flush();
    // Flush sidecar events
    if (sidecarBufferRef.current.length > 0) {
      const events = [...sidecarBufferRef.current];
      sidecarBufferRef.current = [];
      await recordSidecarEvents(sessionId, token, events);
    }
    // Complete session
    await completeSession(sessionId, token);
    stopCapture();
    // Fetch final session data
    const sessionResult = await getSession(sessionId);
    if (sessionResult.success) {
      setSessionData(sessionResult.data);
    }
    setPhase(PHASE.COMPLETED);
    setLoading(false);
  };

  const handleReshare = async () => {
    const stream = await startCapture();
    if (stream) {
      setShowResharePrompt(false);
    }
  };

  const handleGenerateTranscript = async () => {
    setTranscriptStatus("generating");
    const result = await generateTranscript(sessionId);
    if (!result.success) {
      setTranscriptStatus("failed");
      setError(result.error || "Transcript generation failed");
      return;
    }
    // Poll for completion
    const poll = setInterval(async () => {
      const sessionResult = await getSession(sessionId);
      if (sessionResult.success) {
        setSessionData(sessionResult.data);
        const status = sessionResult.data.transcript?.status;
        if (status === "completed") {
          clearInterval(poll);
          setTranscriptStatus("completed");
          const transcriptResult = await getTranscriptContent(sessionId);
          if (transcriptResult.success) {
            setTranscriptContent(transcriptResult.data);
          }
        } else if (status === "failed") {
          clearInterval(poll);
          setTranscriptStatus("failed");
          setError(
            sessionResult.data.transcript?.error || "Transcript generation failed"
          );
        }
      }
    }, 3000);
  };

  const handleInterpretTranscript = async () => {
    setInterpretStatus("loading");
    setError(null);
    const result = await interpretTranscript(sessionId);
    if (!result.success) {
      setInterpretStatus("failed");
      setError(result.error || "Activity interpretation failed");
      return;
    }
    setChunkedResult(result.data.chunked);
    setStatefulResult(result.data.stateful);
    setInterpretStatus("done");
  };

  const handleLoadCompanionTranscript = async () => {
    setCompanionTranscriptLoading(true);
    setError(null);
    const result = await getCompanionTranscript(sessionId, token);
    setCompanionTranscriptLoading(false);
    if (result.success) {
      setCompanionTranscript(result.data.messages || []);
    } else {
      setError(result.error || "Failed to load companion transcript");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className={`mx-auto ${phase === PHASE.COMPLETED ? "max-w-4xl" : "max-w-2xl"}`}>
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3">
            <Monitor className="w-6 h-6 text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Proctoring Test Page
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Dev-only page to test screen recording and transcript generation
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 bg-yellow-50 text-yellow-700 text-xs px-2.5 py-1 rounded-full border border-yellow-200">
            <AlertCircle className="w-3 h-3" />
            Development only — disabled in production
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Phase: Setup */}
        {phase === PHASE.SETUP && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center"
          >
            <p className="text-gray-600 mb-6">
              This creates a dummy submission and proctoring session so you can
              test the full recording pipeline without setting up an assessment.
            </p>
            <Button
              onClick={handleCreateSession}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Create Test Session
            </Button>
          </motion.div>
        )}

        {/* Phase: Consent */}
        {phase === PHASE.CONSENT && (
          <ConsentScreen onConsent={handleConsent} onDecline={handleDecline} />
        )}

        {/* Phase: Recording */}
        {phase === PHASE.RECORDING && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-8"
          >
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Recording in Progress
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Your screen is being captured. Do some work, switch tabs, etc. to
                generate interesting transcript data.
              </p>
            </div>

            {/* Video recording stats */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isVideoRecording ? "bg-red-500 animate-pulse" : videoFailed ? "bg-yellow-500" : "bg-gray-300"}`} />
                <span className="text-xs font-medium text-gray-600">
                  {isVideoRecording ? "Video Recording Active" : videoFailed ? "Video Failed — Screenshot Fallback" : "Video Idle"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-gray-500">Video Chunks</div>
                  <div className="text-2xl font-mono font-bold text-blue-600">
                    {videoChunkCount}
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-gray-500">Chunks Uploaded</div>
                  <div className="text-2xl font-mono font-bold text-green-600">
                    {videoUploadedChunks}
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-gray-500">Video Size</div>
                  <div className="text-2xl font-mono font-bold text-blue-600">
                    {(totalVideoBytes / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
              </div>
            </div>

            {/* Screenshot fallback stats */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">Screenshots (Fallback)</div>
                <div className="text-2xl font-mono font-bold text-gray-900">
                  {frameCount}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">Screenshots Uploaded</div>
                <div className="text-2xl font-mono font-bold text-green-600">
                  {uploadedCount}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">Duplicates Skipped</div>
                <div className="text-2xl font-mono font-bold text-gray-400">
                  {duplicatesSkipped}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">Failed Uploads</div>
                <div className="text-2xl font-mono font-bold text-red-500">
                  {failedCount}
                </div>
              </div>
            </div>

            <div className="text-center">
              <Button
                onClick={handleStopRecording}
                disabled={loading}
                variant="destructive"
                className="px-8"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                Stop Recording & Complete
              </Button>
            </div>

            {sessionId && (
              <p className="text-xs text-gray-400 text-center mt-4 font-mono">
                Session: {sessionId}
              </p>
            )}
          </motion.div>
        )}

        {/* Phase: Completed */}
        {phase === PHASE.COMPLETED && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Session summary */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  Session Complete
                </h2>
              </div>

              {sessionData && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Total Frames:</span>{" "}
                    <span className="font-mono">
                      {sessionData.stats?.totalFrames || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Unique Frames:</span>{" "}
                    <span className="font-mono">
                      {sessionData.stats?.uniqueFrames || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Deduped:</span>{" "}
                    <span className="font-mono">
                      {sessionData.stats?.duplicatesSkipped || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Size:</span>{" "}
                    <span className="font-mono">
                      {(
                        (sessionData.stats?.totalSizeBytes || 0) /
                        1024 /
                        1024
                      ).toFixed(2)}{" "}
                      MB
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Video Chunks:</span>{" "}
                    <span className="font-mono">
                      {sessionData.videoChunks?.length || 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Video Size:</span>{" "}
                    <span className="font-mono">
                      {(totalVideoBytes / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Session ID:</span>{" "}
                    <span className="font-mono text-xs">{sessionId}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ElevenLabs companion transcript (in-session voice) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  ElevenLabs Companion Transcript
                </h2>
                <span className="text-xs text-gray-400 font-normal">(in-session voice)</span>
              </div>
              {companionTranscriptLoading && (
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </p>
              )}
              {!companionTranscriptLoading && companionTranscript == null && (
                <div>
                  <p className="text-sm text-gray-500 mb-4">
                    Load the persisted companion transcript from the server (voice check-ins during recording).
                  </p>
                  <Button
                    onClick={handleLoadCompanionTranscript}
                    variant="outline"
                    className="border-gray-300"
                  >
                    Load Companion Transcript
                  </Button>
                </div>
              )}
              {!companionTranscriptLoading && Array.isArray(companionTranscript) && companionTranscript.length === 0 && (
                <p className="text-sm text-gray-400 italic">No companion messages recorded.</p>
              )}
              {!companionTranscriptLoading && companionTranscript && companionTranscript.length > 0 && (
                <div className="space-y-2 max-h-[400px] overflow-auto">
                  {companionTranscript.map((msg, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 text-sm ${
                        msg.role === "agent"
                          ? "bg-gray-50 border-gray-200"
                          : "bg-blue-50/50 border-blue-200"
                      }`}
                    >
                      <span className="text-xs font-medium text-gray-500 block mb-1">
                        {msg.role === "agent" ? "Companion" : "You"}
                      </span>
                      <p className="text-gray-800 whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Raw transcript (VLM output) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  Raw Transcript
                </h2>
                <span className="text-xs text-gray-400 font-normal">(VLM output)</span>
              </div>

              {!transcriptStatus && (
                <div>
                  <p className="text-sm text-gray-500 mb-4">
                    Generate an AI transcript from the recorded video using
                    GPT-4o vision (falls back to screenshots if no video).
                  </p>
                  <Button
                    onClick={handleGenerateTranscript}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Transcript
                  </Button>
                </div>
              )}

              {transcriptStatus === "generating" && (
                <div className="flex items-center gap-3 text-blue-600">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">
                    Generating transcript... This may take a minute.
                  </span>
                </div>
              )}

              {transcriptStatus === "completed" && transcriptContent && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Transcript generated successfully
                      </span>
                    </div>
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs">
                      <button
                        onClick={() => setTranscriptView("readable")}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          transcriptView === "readable"
                            ? "bg-white shadow-sm text-gray-900 font-medium"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        Readable
                      </button>
                      <button
                        onClick={() => setTranscriptView("raw")}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          transcriptView === "raw"
                            ? "bg-white shadow-sm text-gray-900 font-medium"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        Raw JSON
                      </button>
                    </div>
                  </div>

                  {transcriptView === "raw" ? (
                    <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-auto max-h-96 font-mono">
                      {transcriptContent
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => {
                          try {
                            return JSON.stringify(JSON.parse(line), null, 2);
                          } catch {
                            return line;
                          }
                        })
                        .join("\n\n")}
                    </pre>
                  ) : (
                    <TranscriptReadableView content={transcriptContent} />
                  )}
                </div>
              )}

              {transcriptStatus === "failed" && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">
                    Transcript generation failed. Check server logs.
                  </span>
                </div>
              )}
            </div>

            {/* Activity interpreter: raw → processed (both strategies) */}
            {transcriptStatus === "completed" && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-semibold text-gray-900">
                    Activity Interpreter
                  </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                  Run both processing strategies (Chunked and Stateful) on the raw
                  transcript above. Compare behavioral events and session narratives.
                </p>

                {!interpretStatus && (
                  <Button
                    onClick={handleInterpretTranscript}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Run both strategies (Chunked & Stateful)
                  </Button>
                )}

                {interpretStatus === "loading" && (
                  <div className="flex items-center gap-3 text-indigo-600">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">
                      Running both strategies... This may take a minute.
                    </span>
                  </div>
                )}

                {interpretStatus === "done" && (chunkedResult || statefulResult) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                    <div className="rounded-lg border border-gray-200 p-4 bg-blue-50/30">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Processed (Chunked)
                      </h3>
                      <EnrichedTranscriptView
                        result={chunkedResult}
                        strategyLabel="LLM-Chunked"
                      />
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4 bg-emerald-50/30">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Processed (Stateful)
                      </h3>
                      <EnrichedTranscriptView
                        result={statefulResult}
                        strategyLabel="Stateful-Sequential"
                      />
                    </div>
                  </div>
                )}

                {interpretStatus === "failed" && (
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">
                      Activity interpretation failed. Check server logs.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Frame debug viewer: load frames (detection runs once), then Export overlay uses that frame's regions */}
            <FrameDebugViewer sessionId={sessionId} />

            {/* Start over */}
            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => {
                  setPhase(PHASE.SETUP);
                  setSessionId(null);
                  setToken(null);
                  setSubmissionId(null);
                  setSessionData(null);
                  setTranscriptStatus(null);
                  setTranscriptContent(null);
                  setInterpretStatus(null);
                  setChunkedResult(null);
                  setStatefulResult(null);
                  setCompanionTranscript(null);
                  setError(null);
                }}
              >
                Start New Test Session
              </Button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Companion notch + floating indicators */}
      {phase === PHASE.RECORDING && isSharing && sessionId && token && (
        <ProctoringCompanionNotch
          ref={companionRef}
          sessionId={sessionId}
          token={token}
          submissionId={submissionId}
        />
      )}
      {phase === PHASE.RECORDING && isSharing && (
        <>
          <RecordingIndicator streamCount={streams.length} />
          <StreamStatusPanel
            frameCount={frameCount}
            uploadedCount={uploadedCount}
            failedCount={failedCount}
            duplicatesSkipped={duplicatesSkipped}
            isUploading={isUploading}
          />
        </>
      )}

      {/* Reshare prompt */}
      {showResharePrompt && (
        <ResharePrompt
          onReshare={handleReshare}
          onDismiss={() => setShowResharePrompt(false)}
        />
      )}
    </div>
  );
}
