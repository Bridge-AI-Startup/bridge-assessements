import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderOpen,
  Mic,
  Monitor,
  Play,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import bridgeLogo from "@/assets/bridge-logo.svg";
import { STARTER_ZIP_FILENAME } from "@/lib/downloadStarterCode";
import {
  acquireCompanionMicrophone,
  listenForMicrophoneAudio,
  probeElevenLabsReachability,
  stopMediaStream,
  voiceCheckCopy,
} from "@/lib/companionVoiceCheck";
import { METER_RMS_FULL, SPEECH_RMS_THRESHOLD } from "@/lib/micLevel";

export function CaptureSetupCommand({ command, copied, onCopy }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded-md bg-[#21201C] px-3 py-2 text-xs text-gray-100 font-mono overflow-x-auto whitespace-nowrap">
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

function StepNumber({ n }) {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#21201C] text-xs font-mono text-white">
      {n}
    </span>
  );
}

function VoiceLevelMeter({ level }) {
  const pct = Math.min(100, Math.round((level / METER_RMS_FULL) * 100));
  return (
    <div
      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/80"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-[#21201C] transition-[width] duration-75"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Pre-timer gate. Screen share and the voice-companion probe happen here;
 * starter files and the brief wait until they start so nobody can read ahead
 * off the clock. When screen recording is required, Start stays disabled
 * until they share their entire screen (`displaySurface === "monitor"`, or
 * any share if the browser does not report a surface). When the voice
 * companion is on, Start also waits for a spoken mic check (permission +
 * we actually hear them) and an ElevenLabs reachability ping (ad blockers
 * otherwise fail after the timer starts).
 */
export default function AssessmentSetup({
  title,
  companyName,
  timeLimitDisplay,
  usesScreenRecording,
  recordingSkipped,
  isSharing,
  isSharingFullScreen,
  displaySurface,
  onShareScreen,
  usesVoiceCheck = false,
  hasStarterZip,
  hasStarterRepo,
  usesWorkflowCapture,
  isFinishing,
  onFinishSetup,
  onOptOut,
}) {
  const showScreenStatus = usesScreenRecording && !recordingSkipped;
  const [voiceStatus, setVoiceStatus] = useState(
    usesVoiceCheck ? "checking" : "skipped"
  );
  const [voiceReason, setVoiceReason] = useState(null);
  const [voiceAttempt, setVoiceAttempt] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceQuiet, setVoiceQuiet] = useState(false);
  const resumeListenRef = useRef(null);

  useEffect(() => {
    if (!usesVoiceCheck) {
      setVoiceStatus("skipped");
      setVoiceReason(null);
      setVoiceLevel(0);
      setVoiceQuiet(false);
      return undefined;
    }

    const abort = new AbortController();
    let stream = null;
    let quietTimer = 0;
    setVoiceStatus("checking");
    setVoiceReason(null);
    setVoiceLevel(0);
    setVoiceQuiet(false);

    const fail = (reason) => {
      if (abort.signal.aborted) return;
      abort.abort();
      stopMediaStream(stream);
      stream = null;
      setVoiceStatus("failed");
      setVoiceReason(reason);
      setVoiceLevel(0);
    };

    (async () => {
      const mic = await acquireCompanionMicrophone();
      if (abort.signal.aborted) {
        if (mic.ok) stopMediaStream(mic.stream);
        return;
      }
      if (!mic.ok) {
        fail(mic.reason);
        return;
      }
      stream = mic.stream;

      const elPromise = probeElevenLabsReachability();
      elPromise.then((el) => {
        if (!el.ok) fail(el.reason);
      });

      let listenInFlight = false;
      const listen = async () => {
        if (abort.signal.aborted || !stream || listenInFlight) return;
        listenInFlight = true;
        setVoiceStatus("listening");
        setVoiceQuiet(false);
        window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(() => {
          if (!abort.signal.aborted) setVoiceQuiet(true);
        }, 6000);

        const audio = await listenForMicrophoneAudio(stream, {
          signal: abort.signal,
          onLevel: (rms) => {
            if (abort.signal.aborted) return;
            setVoiceLevel(rms);
            // The quiet warning is a 6s wall clock, not "6s of silence".
            // Reset it whenever the signal that counts toward a pass arrives,
            // otherwise the bar moves while we still claim we haven't heard them.
            if (rms >= SPEECH_RMS_THRESHOLD) {
              setVoiceQuiet(false);
              window.clearTimeout(quietTimer);
              quietTimer = window.setTimeout(() => {
                if (!abort.signal.aborted) setVoiceQuiet(true);
              }, 6000);
            }
          },
        });

        window.clearTimeout(quietTimer);
        if (abort.signal.aborted) return;

        if (audio.reason === "needs_gesture") {
          setVoiceStatus("needs_gesture");
          setVoiceLevel(0);
          return;
        }
        if (!audio.ok) {
          if (audio.reason !== "cancelled") fail(audio.reason);
          return;
        }

        const el = await elPromise;
        if (abort.signal.aborted) return;
        if (!el.ok) {
          fail(el.reason);
          return;
        }

        stopMediaStream(stream);
        stream = null;
        setVoiceStatus("ready");
        setVoiceReason(null);
        setVoiceLevel(0);
        setVoiceQuiet(false);
      };

      const listenGuarded = async () => {
        try {
          await listen();
        } finally {
          listenInFlight = false;
        }
      };

      resumeListenRef.current = listenGuarded;
      await listenGuarded();
    })();

    return () => {
      resumeListenRef.current = null;
      abort.abort();
      window.clearTimeout(quietTimer);
      stopMediaStream(stream);
    };
  }, [usesVoiceCheck, voiceAttempt]);

  const voiceReady = !usesVoiceCheck || voiceStatus === "ready";
  const voiceCopy = voiceStatus === "failed" ? voiceCheckCopy(voiceReason) : null;
  const knownPartialShare =
    isSharing &&
    (displaySurface === "window" ||
      displaySurface === "browser" ||
      displaySurface === "application");
  const verifiedFullScreen =
    isSharingFullScreen || (isSharing && !knownPartialShare && !displaySurface);
  const needsReshare = showScreenStatus && !verifiedFullScreen;
  const needsVoice = usesVoiceCheck && !voiceReady;

  let preview = 1;
  const starterPreview = hasStarterZip || hasStarterRepo ? preview++ : null;
  const capturePreview = usesWorkflowCapture ? preview++ : null;
  const editorPreview =
    usesWorkflowCapture || hasStarterZip || hasStarterRepo ? preview++ : null;
  const hasPreview =
    starterPreview != null || capturePreview != null || editorPreview != null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAF9F2] to-[#F4F2E9] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-card border border-border shadow-[0_2px_18px_rgba(33,32,28,0.06)] overflow-hidden"
      >
        <div className="bg-[#21201C] px-8 py-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4 overflow-hidden">
            <img
              src={bridgeLogo}
              alt="Bridge"
              className="w-full h-full object-contain"
            />
          </div>
          <p className="eyebrow text-white/70 mb-2">Before you start</p>
          <h1 className="text-2xl font-medium tracking-[-0.012em] text-white mb-1">
            {title}
          </h1>
          {companyName && (
            <p className="text-white/70 text-sm mt-2">From {companyName}</p>
          )}
        </div>

        <div className="p-8">
          <div className="flex items-center justify-center gap-2 mb-6 py-3 bg-gray-50 rounded-xl text-sm text-gray-600">
            <Clock className="w-4 h-4 text-[#21201C]" />
            <span>
              {timeLimitDisplay} once you start — the timer has not started
            </span>
          </div>

          {showScreenStatus && (
            <div
              className={`mb-6 rounded-xl border p-4 ${
                verifiedFullScreen
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-start gap-3">
                {verifiedFullScreen ? (
                  <CheckCircle2 className="w-6 h-6 text-green-700 flex-shrink-0 mt-0.5" />
                ) : (
                  <Monitor className="w-6 h-6 text-amber-800 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  {verifiedFullScreen ? (
                    <>
                      <h2 className="text-sm font-semibold text-green-900">
                        Entire screen is shared
                      </h2>
                      <p className="mt-1 text-sm text-green-900/80">
                        You picked your full display. Keep sharing until you
                        submit.
                      </p>
                      {!isSharingFullScreen && (
                        <button
                          type="button"
                          onClick={onShareScreen}
                          className="mt-2 text-xs font-medium text-green-900 underline underline-offset-2"
                        >
                          Reshare if this isn&apos;t your entire screen
                        </button>
                      )}
                    </>
                  ) : isSharing ? (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        Reshare your entire screen
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        You shared a window or a browser tab. Choose{" "}
                        <strong>Entire Screen</strong> (your full display) so
                        the attempt can be scored.
                      </p>
                      <Button
                        type="button"
                        onClick={onShareScreen}
                        className="mt-3 h-9 px-3 text-xs"
                      >
                        <Monitor className="w-3.5 h-3.5 mr-1.5" />
                        Reshare entire screen
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        Share your entire screen
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        Choose <strong>Entire Screen</strong> — not a window or
                        a browser tab. Sharing only an app can make the attempt
                        ineligible.
                      </p>
                      <Button
                        type="button"
                        onClick={onShareScreen}
                        className="mt-3 h-9 px-3 text-xs"
                      >
                        <Monitor className="w-3.5 h-3.5 mr-1.5" />
                        Share entire screen
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {usesVoiceCheck && (
            <div
              className={`mb-6 rounded-xl border p-4 ${
                voiceStatus === "ready"
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-start gap-3">
                {voiceStatus === "ready" ? (
                  <CheckCircle2 className="w-6 h-6 text-green-700 flex-shrink-0 mt-0.5" />
                ) : (
                  <Mic className="w-6 h-6 text-amber-800 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  {voiceStatus === "ready" ? (
                    <>
                      <h2 className="text-sm font-semibold text-green-900">
                        Voice check-in is ready
                      </h2>
                      <p className="mt-1 text-sm text-green-900/80">
                        We heard you. The check-in starts after you begin the
                        assessment.
                      </p>
                    </>
                  ) : voiceStatus === "checking" ? (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        Checking the voice check-in
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        Allow the microphone if asked. Then say something so we
                        know it works.
                      </p>
                    </>
                  ) : voiceStatus === "listening" ? (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        Say something
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        Speak for a second so we know the microphone works.
                        &ldquo;Check, check&rdquo; is fine.
                      </p>
                      <VoiceLevelMeter level={voiceLevel} />
                      {voiceQuiet && (
                        <>
                          <p className="mt-2 text-xs text-amber-950/80">
                            We haven&apos;t heard you yet. Unmute the mic or
                            speak a bit closer.
                          </p>
                          <button
                            type="button"
                            onClick={() => setVoiceAttempt((n) => n + 1)}
                            className="mt-2 text-xs font-medium text-amber-950 underline underline-offset-2"
                          >
                            Try a different microphone
                          </button>
                        </>
                      )}
                    </>
                  ) : voiceStatus === "needs_gesture" ? (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        Check the microphone
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        Click below, then say something so we know it works.
                      </p>
                      <Button
                        type="button"
                        onClick={() => resumeListenRef.current?.()}
                        className="mt-3 h-9 px-3 text-xs"
                      >
                        <Mic className="w-3.5 h-3.5 mr-1.5" />
                        Check microphone
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-sm font-semibold text-amber-950">
                        {voiceCopy.title}
                      </h2>
                      <p className="mt-1 text-sm text-amber-950">
                        {voiceCopy.body}
                      </p>
                      <Button
                        type="button"
                        onClick={() => setVoiceAttempt((n) => n + 1)}
                        className="mt-3 h-9 px-3 text-xs"
                      >
                        <Mic className="w-3.5 h-3.5 mr-1.5" />
                        Try voice check again
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {hasPreview && (
            <>
          <p className="text-sm text-gray-700 mb-4">
            When you start, the assignment is shown and the timer begins. You
            will then:
          </p>

          <ol className="space-y-4 mb-6">
            {starterPreview != null && (
              <li className="flex gap-3">
                <StepNumber n={starterPreview} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-[#21201C]">
                    {hasStarterZip
                      ? `Unzip ${STARTER_ZIP_FILENAME}`
                      : "Open the starter repository"}
                  </h2>
                  <p className="mt-1 text-sm text-gray-700">
                    {hasStarterZip
                      ? "Starter files download when you start. Unzip them and work in that folder — not a blank project."
                      : "A starter repo link will appear when you start. Work from those files — not a blank project."}
                  </p>
                </div>
              </li>
            )}

            {capturePreview != null && (
              <li className="flex gap-3">
                <StepNumber n={capturePreview} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#21201C]" />
                    <h2 className="text-sm font-semibold text-[#21201C]">
                      Run the tracking command from that folder
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-gray-700">
                    The command appears after you start. It shows exactly what
                    is recorded and asks you to type “agree” before anything is
                    captured.
                  </p>
                </div>
              </li>
            )}

            {editorPreview != null && (
              <li className="flex gap-3">
                <StepNumber n={editorPreview} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-[#21201C]" />
                    <h2 className="text-sm font-semibold text-[#21201C]">
                      {usesWorkflowCapture
                        ? "Open your AI assistant in that folder"
                        : "Open the starter folder in your editor"}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-gray-700">
                    {usesWorkflowCapture ? (
                      <>
                        Start Claude Code, Cursor, or Codex in the same folder
                        (for example <code className="font-mono">claude</code>
                        ). The first time, it will ask you to trust the folder —
                        you must accept, or nothing is recorded.
                      </>
                    ) : (
                      <>
                        Open the unzipped starter in your usual editor and
                        start from those files.
                      </>
                    )}
                  </p>
                </div>
              </li>
            )}
          </ol>
            </>
          )}

          <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-6">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-800">
              <strong>Next:</strong> starting reveals the assignment and begins
              the {timeLimitDisplay} timer.
            </p>
          </div>

          {(needsReshare || needsVoice) && (
            <p className="text-xs text-gray-500 mb-3 text-center">
              {needsReshare && needsVoice
                ? "Share your entire screen and say something into the microphone to start"
                : needsReshare
                  ? "Share your entire screen to start"
                  : "Say something into the microphone to start"}
            </p>
          )}

          <Button
            onClick={onFinishSetup}
            disabled={isFinishing || needsReshare || needsVoice}
            className="w-full bg-[#21201C] hover:bg-[#35332D] text-white py-6 text-lg rounded-full disabled:opacity-50 mb-3"
          >
            <Play className="w-5 h-5 mr-2" />
            {isFinishing ? "Starting..." : "Start assessment"}
          </Button>

          <button
            type="button"
            onClick={onOptOut}
            className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
          >
            I cannot complete this assessment
          </button>
        </div>
      </motion.div>
    </div>
  );
}
