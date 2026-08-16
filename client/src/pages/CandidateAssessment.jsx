import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Clock,
  AlertCircle,
  Play,
  Link as LinkIcon,
  Send,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getSubmissionByToken,
  startAssessment,
  submitAssessment,
  uploadAssessmentArchive,
  submitRecordingOnlyAssessment,
  optOutAssessment,
} from "@/api/submission";
import { createPageUrl } from "@/utils";
import bridgeLogo from "@/assets/bridge-logo.svg";
import useScreenCapture from "@/hooks/useScreenCapture";
import ConsentScreen from "@/components/proctoring/ConsentScreen";
import RecordingIndicator from "@/components/proctoring/RecordingIndicator";
import {
  createProctoringSession,
  getSessionByCandidateToken,
  grantConsent,
  recordSidecarEvents,
  completeSession as completeProctoringSession,
  beaconSidecarEvents,
  beaconCompleteSession,
  uploadVideoChunk,
} from "@/api/proctoring";
import useScreenshotCapture from "@/hooks/useScreenshotCapture";
import useFrameUpload from "@/hooks/useFrameUpload";
import useFrameDedup from "@/hooks/useFrameDedup";
import ResharePrompt from "@/components/proctoring/ResharePrompt";
import ProctoringCompanionNotch from "@/components/proctoring/ProctoringCompanionNotch";
import { COMPANION_ENABLED } from "@/config/companion";
import { API_BASE_URL } from "@/config/api";
import { createVideoRecorder } from "@/lib/captureUtils";
import StarterCodeIDE from "@/components/StarterCodeIDE";
import SubmissionFileDropzone from "@/components/assessment/SubmissionFileDropzone";
import AssessmentSetup, {
  CaptureSetupCommand,
} from "@/components/assessment/AssessmentSetup";
import {
  buildStarterCodeZipBlob,
  downloadStarterCodeZip,
  STARTER_ZIP_FILENAME,
  triggerBlobDownload,
} from "@/lib/downloadStarterCode";

const SETUP_STORAGE_PREFIX = "bridge-assessment-setup:";

const FINAL_SUBMISSION_GRACE_SECONDS = 5 * 60; // keep in lockstep with server FINAL_SUBMISSION_GRACE_MINUTES
const CAPTURE_API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
/** MediaRecorder timeslice. Chunks are uploaded (and dropped) as they arrive — never buffered whole. */
const VIDEO_CHUNK_MS = 30000;

/**
 * Stop a recorder entry at most once and memoize the stop promise.
 * MediaRecorder.stop() flushes a final `dataavailable` before `onstop`, so
 * awaiting this and then `entry.uploads` guarantees the last chunk is uploaded
 * before the proctoring session is completed.
 */
function stopRecorderEntry(entry) {
  if (!entry.stopPromise) {
    entry.stopped = true;
    entry.stopPromise = Promise.resolve()
      .then(() => entry.stop?.())
      .catch(() => {
        /* already stopped */
      });
  }
  return entry.stopPromise;
}

function formatHms(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function playBuzzerSound() {
  try {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.08;
    master.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc2.type = "square";
    osc1.frequency.value = 180;
    osc2.frequency.value = 90;
    osc1.connect(master);
    osc2.connect(master);
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.8);
    osc2.stop(ctx.currentTime + 0.8);

    // Close the context after playback to avoid leaking audio resources.
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Best effort only; timeout behavior must continue even without sound.
  }
}

export default function CandidateAssessment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const captureSetupCommand = token
    ? `node capture-kit/setup.js ${token} --api=${CAPTURE_API_ORIGIN}`
    : "";

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [uploadArchive, setUploadArchive] = useState(null);
  const [uploadArchiveInfo, setUploadArchiveInfo] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null); // in minutes
  const [timeDisplay, setTimeDisplay] = useState(""); // formatted display
  const [showOptOutModal, setShowOptOutModal] = useState(false);
  const [optOutReason, setOptOutReason] = useState("");
  const [isOptingOut, setIsOptingOut] = useState(false);
  const [isGracePeriodActive, setIsGracePeriodActive] = useState(false);
  const [graceSecondsRemaining, setGraceSecondsRemaining] = useState(
    FINAL_SUBMISSION_GRACE_SECONDS
  );
  const [hasMissedGracePeriod, setHasMissedGracePeriod] = useState(false);

  // Proctoring state
  const [showConsent, setShowConsent] = useState(false);
  // Client-only: consent + workspace setup happen while status is still pending.
  const [inSetup, setInSetup] = useState(false);
  // Server-resolved evidence mode: "none" | "workflow" | "both".
  // Drives whether we ask for the screen, show the capture-kit command, or both.
  const evidenceMode = submission?.evidenceMode || "both";
  const usesWorkflowCapture =
    evidenceMode === "workflow" || evidenceMode === "both";
  const usesScreenRecording = evidenceMode === "both";
  // PNG stills existed only to feed the OCR transcript, which went away with
  // the "screen" mode. `both` records video for playback and keeps the sidecar
  // events; nothing consumes screenshots, so the pipeline is never armed.
  const usesFrameCapture = false;
  const hasStarterZip = (assessment?.starterCodeFiles?.length ?? 0) > 0;
  const hasStarterRepo = Boolean(assessment?.starterFilesGitHubLink);
  const needsWorkspaceSetup =
    usesScreenRecording || usesWorkflowCapture || hasStarterZip || hasStarterRepo;
  const [captureCmdCopied, setCaptureCmdCopied] = useState(false);
  const starterZipUrlRef = useRef(null);
  const [proctoringEnabled, setProctoringEnabled] = useState(false);
  const [proctoringSessionId, setProctoringSessionId] = useState(null);
  const [proctoringSubmissionId, setProctoringSubmissionId] = useState(null);
  const screenCapture = useScreenCapture();
  const sidecarBufferRef = useRef([]);
  /** In-session voice companion; endAndFlush() must run before the session completes. */
  const companionRef = useRef(null);
  /** True while the attempt is in-progress — stream-loss companion prompts only then. */
  const inProgressRef = useRef(false);

  // Screenshot capture (legacy `screen` only — OCR transcript input)
  const { consumeFrames } = useScreenshotCapture(screenCapture.streams, {
    enabled: usesFrameCapture && proctoringEnabled && screenCapture.isSharing,
  });

  // Frame upload pipeline
  const { flush: flushFrames } = useFrameUpload({
    sessionId: proctoringSessionId,
    token,
    consumeFrames,
    enabled: usesFrameCapture && proctoringEnabled && !!proctoringSessionId,
  });

  // Frame dedup
  const { shouldKeepFrame } = useFrameDedup();

  /** Whether the voice overlay is on screen (drives the page's bottom padding). */
  const companionMounted =
    COMPANION_ENABLED && proctoringEnabled && !!proctoringSessionId && !!token;

  // Stream lost state for reshare prompt
  const [showResharePrompt, setShowResharePrompt] = useState(false);
  /** True when prompting because of page reload / remount (stream was never started this visit). */
  const [reshareIsResume, setReshareIsResume] = useState(false);
  /**
   * True while we believe screen sharing is down (track ended, or a reload left
   * us with no stream). Single source of truth for the lost/restored pair, so
   * neither event can be emitted twice nor skipped.
   */
  const sharingDownRef = useRef(false);
  /** Incremented on every in-progress stream loss / resume so the companion speaks each time. */
  const [companionReshareTick, setCompanionReshareTick] = useState(0);
  const [companionShareRestoredTick, setCompanionShareRestoredTick] =
    useState(0);
  const timeoutTriggeredRef = useRef(false);
  const stopProctoringPromiseRef = useRef(null);
  const buzzerPlayedRef = useRef(false);
  const recordingOnlySubmitTriggeredRef = useRef(false);
  const proctoringStoppedRef = useRef(false);
  const timeRemainingRef = useRef(null);
  const [recorderEpoch, setRecorderEpoch] = useState(0);

  // Video recording refs
  const videoRecordersRef = useRef([]);

  // Load submission on mount
  useEffect(() => {
    if (!token) {
      alert("No token provided in URL");
      setIsLoading(false);
      return;
    }

    const loadSubmission = async () => {
      setIsLoading(true);
      try {
        const result = await getSubmissionByToken(token);
        if (result.success) {
          setSubmission(result.data);
          const assessmentData = result.data.assessmentId;
          if (typeof assessmentData === "object" && assessmentData !== null) {
            setAssessment(assessmentData);
          }

          // If already submitted or expired, redirect to submitted page
          if (
            result.data.status === "submitted" ||
            result.data.status === "expired"
          ) {
            navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
            return;
          }

          // If opted out, stop here - don't redirect, just show the opted out screen
          // This prevents redirect loops and API spam
          if (result.data.status === "opted-out") {
            setIsLoading(false);
            return;
          }

          if (result.data.status === "pending") {
            // Setup is client-side (timer has not started). Resume it after a
            // refresh so they are not dumped back on the landing card.
            let setupMarked = false;
            try {
              setupMarked =
                sessionStorage.getItem(`${SETUP_STORAGE_PREFIX}${token}`) ===
                "1";
            } catch {
              setupMarked = false;
            }
            if (setupMarked) {
              setInSetup(true);
              const mode = result.data.evidenceMode || "both";
              const screenOn = mode === "both";
              if (screenOn) {
                try {
                  const pRes = await getSessionByCandidateToken(token);
                  if (pRes.success && pRes.data) {
                    const sess = pRes.data;
                    const resumable =
                      sess.consent?.granted &&
                      (sess.status === "active" ||
                        sess.status === "paused" ||
                        sess.status === "pending");
                    if (resumable) {
                      setProctoringSessionId(sess._id);
                      setProctoringSubmissionId(String(result.data._id));
                      setProctoringEnabled(true);
                      // A reload ends screen capture: we are down until they reshare.
                      sharingDownRef.current = true;
                      setReshareIsResume(true);
                      setShowResharePrompt(true);
                      // Companion is not mounted during setup — UI reshare is enough.
                    }
                  }
                } catch (e) {
                  console.warn("Could not resume setup recording:", e);
                }
              }
            }
          }

          if (result.data.status === "in-progress") {
            setTimeRemaining(result.data.timeRemaining);
            // Reattach to an existing proctoring session after reload (browser ends screen share on refresh).
            try {
              const pRes = await getSessionByCandidateToken(token);
              if (pRes.success && pRes.data) {
                const sess = pRes.data;
                const resumable =
                  sess.consent?.granted &&
                  (sess.status === "active" || sess.status === "paused");
                if (resumable) {
                  setProctoringSessionId(sess._id);
                  setProctoringSubmissionId(String(result.data._id));
                  setProctoringEnabled(true);
                  // A reload ends screen capture: we are down until they reshare.
                  sharingDownRef.current = true;
                  setReshareIsResume(true);
                  setShowResharePrompt(true);
                  setCompanionReshareTick((n) => n + 1);
                }
              }
            } catch (e) {
              console.warn("Could not check proctoring session:", e);
            }
          }
          if (result.data.githubLink) {
            setGithubUrl(result.data.githubLink);
          }
        } else {
          const errorMsg =
            "error" in result ? result.error : "Failed to load assessment";
          alert(errorMsg);
        }
      } catch (error) {
        console.error("Error loading submission:", error);
        alert("Failed to load assessment");
      } finally {
        setIsLoading(false);
      }
    };

    loadSubmission();
  }, [token]);

  // Pre-build the starter zip while they read the landing card so setup can
  // download it in the same click (browsers block downloads after an await).
  useEffect(() => {
    const files = assessment?.starterCodeFiles;
    if (!files?.length) return undefined;
    let revoked = false;
    let objectUrl = null;
    buildStarterCodeZipBlob(files).then((blob) => {
      if (revoked || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      starterZipUrlRef.current = objectUrl;
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (starterZipUrlRef.current === objectUrl) {
        starterZipUrlRef.current = null;
      }
    };
  }, [assessment?.starterCodeFiles]);

  // Sync time with backend every 30 seconds if assessment is in progress
  // IMPORTANT: Don't poll if opted out to prevent API spam
  useEffect(() => {
    if (
      !token ||
      !submission ||
      submission.status !== "in-progress" ||
      submission.status === "opted-out"
    ) {
      return;
    }

    const syncTime = async () => {
      try {
        const result = await getSubmissionByToken(token);
        if (!result.success) return;
        const status = result.data.status;
        if (status === "submitted" || status === "expired") {
          navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
          return;
        }
        if (status === "opted-out") {
          setSubmission(result.data);
          return;
        }
        if (result.data.timeRemaining !== null) {
          setTimeRemaining(result.data.timeRemaining);
        }
      } catch (error) {
        console.error("Error syncing time:", error);
      }
    };

    // Sync immediately
    syncTime();

    // Then sync every 30 seconds
    const interval = setInterval(syncTime, 30000);
    return () => clearInterval(interval);
  }, [token, submission, navigate]);

  // Update time display every second
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) {
      setTimeDisplay("00:00:00");
      return;
    }

    const updateDisplay = () => {
      const hours = Math.floor(timeRemaining / 60);
      const minutes = Math.floor(timeRemaining % 60);
      const seconds = Math.floor((timeRemaining % 1) * 60);
      setTimeDisplay(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
          2,
          "0"
        )}:${String(seconds).padStart(2, "0")}`
      );
    };

    updateDisplay();
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 0) return 0;
        return Math.max(0, prev - 1 / 60); // Decrease by 1 second (1/60 of a minute)
      });
      updateDisplay();
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining]);

  timeRemainingRef.current = timeRemaining;

  /** Stop recorders and flush sidecar/frames. Leaves the session open so a
   *  failed submit can keep recording. */
  const flushPendingCapture = useCallback(async () => {
    // Includes recorders already stopped by a stream ending — their final chunk
    // upload still has to land before the session is completed.
    const recorders = videoRecordersRef.current;
    videoRecordersRef.current = [];
    await Promise.all(
      recorders.map(async (r) => {
        try {
          await stopRecorderEntry(r);
        } catch {
          /* already stopped */
        }
        try {
          await r.uploads;
        } catch {
          /* upload failure already logged */
        }
      })
    );
    await flushFrames();
    const sidecar = sidecarBufferRef.current.splice(0);
    if (sidecar.length > 0 && proctoringSessionId) {
      try {
        await recordSidecarEvents(proctoringSessionId, token, sidecar);
      } catch {
        /* session may already be closed */
      }
    }
  }, [flushFrames, proctoringSessionId, token]);

  const stopProctoringCapture = useCallback(() => {
    if (stopProctoringPromiseRef.current) return stopProctoringPromiseRef.current;
    if (!proctoringEnabled && !proctoringSessionId) return Promise.resolve();

    const run = (async () => {
      proctoringStoppedRef.current = true;
      try {
        // End the voice check-in first so its final lines land before the session closes.
        if (companionRef.current?.endAndFlush) {
          await companionRef.current.endAndFlush();
        }
        await flushPendingCapture();
        if (proctoringSessionId) {
          await completeProctoringSession(proctoringSessionId, token);
        }
      } catch (error) {
        console.error("Failed to stop proctoring:", error);
        stopProctoringPromiseRef.current = null;
      } finally {
        screenCapture.stopCapture();
        setProctoringEnabled(false);
      }
    })();

    stopProctoringPromiseRef.current = run;
    return run;
  }, [
    proctoringEnabled,
    flushPendingCapture,
    proctoringSessionId,
    token,
    screenCapture,
  ]);

  // Timeout handling: buzzer + stop recording + 5-minute final submission grace.
  useEffect(() => {
    if (!submission || submission.status !== "in-progress") return;
    if (hasMissedGracePeriod || isGracePeriodActive) return;
    if (!assessment?.timeLimit || !submission?.startedAt) return;

    const elapsedSeconds =
      (Date.now() - new Date(submission.startedAt).getTime()) / 1000;
    const allowedSeconds = assessment.timeLimit * 60;
    const overtimeSeconds = Math.max(0, Math.floor(elapsedSeconds - allowedSeconds));
    const mainTimerExpired = timeRemaining !== null && timeRemaining <= 0;
    if (!mainTimerExpired && overtimeSeconds <= 0) return;

    if (overtimeSeconds >= FINAL_SUBMISSION_GRACE_SECONDS) {
      timeoutTriggeredRef.current = true;
      setIsGracePeriodActive(false);
      setGraceSecondsRemaining(0);
      setHasMissedGracePeriod(true);
      stopProctoringCapture();
      return;
    }

    if (!timeoutTriggeredRef.current) {
      timeoutTriggeredRef.current = true;
      if (!buzzerPlayedRef.current) {
        buzzerPlayedRef.current = true;
        playBuzzerSound();
      }
      stopProctoringCapture();
    }

    setHasMissedGracePeriod(false);
    setIsGracePeriodActive(true);
    setGraceSecondsRemaining(FINAL_SUBMISSION_GRACE_SECONDS - overtimeSeconds);
  }, [
    submission,
    assessment,
    timeRemaining,
    isGracePeriodActive,
    hasMissedGracePeriod,
    stopProctoringCapture,
  ]);

  useEffect(() => {
    if (!isGracePeriodActive) return;

    const tick = setInterval(() => {
      setGraceSecondsRemaining((prev) => {
        if (prev <= 1) {
          setIsGracePeriodActive(false);
          setHasMissedGracePeriod(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [isGracePeriodActive]);

  // Auto-submit screen recording once the grace period expires.
  useEffect(() => {
    if (!hasMissedGracePeriod || !token) return;
    if (recordingOnlySubmitTriggeredRef.current) return;
    recordingOnlySubmitTriggeredRef.current = true;

    const finalizeRecordingOnly = async () => {
      try {
        await stopProctoringCapture();
        const result = await submitRecordingOnlyAssessment(token);
        if (result.success) {
          navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
          return;
        }
        const errorMsg =
          "error" in result
            ? result.error
            : "Failed to finalize timed-out assessment";
        alert(errorMsg);
      } catch (error) {
        console.error("Failed to auto-submit screen recording:", error);
        alert("Failed to auto-submit screen recording. Please contact support.");
      }
    };

    finalizeRecordingOnly();
  }, [hasMissedGracePeriod, token, navigate, stopProctoringCapture]);

  // Sidecar event capture: blur/focus/visibilitychange/copy/paste
  useEffect(() => {
    if (!proctoringEnabled || !proctoringSessionId || !token) return;

    const pushEvent = (type, metadata = {}) => {
      sidecarBufferRef.current.push({ type, timestamp: Date.now(), metadata });
    };

    const onBlur = () => pushEvent("window_blur");
    const onFocus = () => pushEvent("window_focus");
    const onVisibility = () => {
      pushEvent(document.hidden ? "window_blur" : "window_focus");
    };
    const onCopy = () => pushEvent("clipboard_copy");
    const onPaste = () => pushEvent("clipboard_paste");

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);

    // Flush buffer every 10 seconds
    const flushInterval = setInterval(async () => {
      if (sidecarBufferRef.current.length === 0) return;
      const events = [...sidecarBufferRef.current];
      sidecarBufferRef.current = [];
      await recordSidecarEvents(proctoringSessionId, token, events);
    }, 10000);

    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      clearInterval(flushInterval);
    };
  }, [proctoringEnabled, proctoringSessionId, token]);

  /** Screen sharing went away. Idempotent — a second track ending is not a second loss. */
  const noteSharingLost = useCallback(({ isResume = false, details } = {}) => {
    setReshareIsResume(isResume);
    setShowResharePrompt(true);
    if (sharingDownRef.current) return;
    sharingDownRef.current = true;
    if (inProgressRef.current) {
      setCompanionReshareTick((n) => n + 1);
    }
    sidecarBufferRef.current.push({
      type: "stream_lost",
      timestamp: Date.now(),
      // Browsers never say WHY a track ended; the hook's context ring (recent
      // focus/visibility/page events) is the only correlation there is, and a
      // candidate cannot be relied on to keep DevTools open. Persist it.
      metadata: details || {},
    });
  }, []);

  /**
   * Screen sharing is live again. Idempotent, and the ONLY writer of
   * `stream_restored` — every resume path (modal reshare, setup reshare, the
   * hook's own restored callback) funnels here so exactly one event is recorded.
   */
  const noteSharingResumed = useCallback(() => {
    setShowResharePrompt(false);
    setReshareIsResume(false);
    if (!sharingDownRef.current) return;
    sharingDownRef.current = false;
    // Unlatch the voice companion. The lost contextual update is often spoken
    // seconds AFTER the candidate has already reshared (a contextual update
    // does not force a turn), and without a positive restore signal the agent
    // keeps insisting the share is down against a healthy stream.
    setCompanionShareRestoredTick((n) => n + 1);
    sidecarBufferRef.current.push({
      type: "stream_restored",
      timestamp: Date.now(),
      metadata: {},
    });
  }, []);

  // Stream lost/restored handlers
  useEffect(() => {
    if (!proctoringEnabled) return;
    screenCapture.onStreamLost((details) => noteSharingLost({ details }));
    screenCapture.onStreamRestored(() => noteSharingResumed());
  }, [proctoringEnabled, screenCapture, noteSharingLost, noteSharingResumed]);

  /**
   * Backstop: the reshare modal must never sit on top of a live share, and the
   * companion must never be told to nag when sharing is in fact up. Whatever
   * path produced the stream (modal, setup panel, hook callback), a live stream
   * closes the loop exactly once.
   */
  useEffect(() => {
    if (!proctoringEnabled || !screenCapture.isSharing) return;
    noteSharingResumed();
  }, [proctoringEnabled, screenCapture.isSharing, noteSharingResumed]);

  useEffect(() => {
    inProgressRef.current = submission?.status === "in-progress";
  }, [submission?.status]);

  // Video recording — one MediaRecorder per live MediaStream.
  //
  // Recorders are keyed by the MediaStream object, NOT by screenIndex: a reshare
  // produces a brand-new stream that reuses screenIndex 0, and an index-keyed
  // check would have skipped it, leaving the rest of the session unrecorded.
  // Entries are kept after stopping so `flushPendingCapture` still awaits their
  // final chunk upload before POST /complete.
  useEffect(() => {
    const live =
      proctoringEnabled && proctoringSessionId && token
        ? screenCapture.streams
        : [];

    for (const entry of videoRecordersRef.current) {
      if (entry.stopped) continue;
      if (live.some((s) => s.stream === entry.stream)) continue;
      void stopRecorderEntry(entry);
    }

    if (live.length === 0) return undefined;

    for (const { stream, screenIndex } of live) {
      const alreadyRecording = videoRecordersRef.current.some(
        (r) => r.stream === stream && !r.stopped
      );
      if (alreadyRecording) continue;

      try {
        const recorderEntry = {
          screenIndex,
          stream,
          stopped: false,
          stopPromise: null,
          uploads: Promise.resolve(),
          // Real start of the next chunk. The old code hard-coded
          // `Date.now() - 30000` for every chunk, so partial chunks (one per
          // recorder, plus every reshare gap) were reported to the server as a
          // full 30s — and the server sums these to get mergedVideo duration.
          lastChunkAt: Date.now(),
        };
        const { recorder, stop } = createVideoRecorder(stream, VIDEO_CHUNK_MS);
        recorderEntry.recorder = recorder;
        recorderEntry.stop = stop;

        // Upload chunks as they arrive. Chain uploads so stop can await the last one
        // before POST /complete — otherwise the final 30s lands after the session
        // is closed and is rejected.
        recorder.ondataavailable = (e) => {
          if (e.data.size === 0 || !proctoringSessionId) return;
          const startTime = recorderEntry.lastChunkAt;
          const endTime = Date.now();
          recorderEntry.lastChunkAt = endTime;
          recorderEntry.uploads = recorderEntry.uploads
            .then(() =>
              uploadVideoChunk(proctoringSessionId, token, e.data, {
                screenIndex,
                startTime,
                endTime,
              })
            )
            .catch((err) => {
              console.warn("Video chunk upload failed:", err);
            });
        };

        videoRecordersRef.current.push(recorderEntry);
      } catch (err) {
        console.warn(`Could not start video recording for screen ${screenIndex}:`, err);
      }
    }

    return undefined;
  }, [proctoringEnabled, proctoringSessionId, token, screenCapture.streams, recorderEpoch]);

  // Recorder teardown belongs to unmount, not to every streams change: the old
  // cleanup stopped and rebuilt every recorder whenever the array changed.
  useEffect(() => {
    return () => {
      videoRecordersRef.current.forEach((r) => {
        try {
          void stopRecorderEntry(r);
        } catch {
          /* page is going away */
        }
      });
      videoRecordersRef.current = [];
    };
  }, []);

  // pagehide: flush JSON we can (sidecar) and complete recording only if the
  // main timer is already up. Do not complete mid-attempt — reload must resume.
  useEffect(() => {
    if (!proctoringEnabled || !proctoringSessionId || !token) return undefined;

    const onPageHide = () => {
      const sidecar = sidecarBufferRef.current.splice(0);
      if (sidecar.length > 0) {
        beaconSidecarEvents(proctoringSessionId, token, sidecar);
      }
      videoRecordersRef.current.forEach((r) => {
        try {
          void stopRecorderEntry(r);
        } catch {
          /* page is dying */
        }
      });
      const remaining = timeRemainingRef.current;
      if (remaining !== null && remaining <= 0) {
        beaconCompleteSession(proctoringSessionId, token);
      }
    };

    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [proctoringEnabled, proctoringSessionId, token]);

  // beforeunload — flush remaining frames (legacy screen OCR only)
  useEffect(() => {
    if (!proctoringEnabled || !usesFrameCapture) return;

    const onBeforeUnload = () => {
      flushFrames();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [proctoringEnabled, usesFrameCapture, flushFrames]);

  const handleReshare = async () => {
    const stream = await screenCapture.startCapture();
    if (stream) {
      // Records `stream_restored` and clears the prompt. Idempotent, so the
      // hook's own restored callback firing as well costs nothing.
      noteSharingResumed();
    }
  };

  const triggerStarterDownload = () => {
    const files = assessment?.starterCodeFiles;
    const readyUrl = starterZipUrlRef.current;
    if (readyUrl) {
      triggerBlobDownload(readyUrl, STARTER_ZIP_FILENAME);
      return;
    }
    if (files?.length) {
      void downloadStarterCodeZip(files, STARTER_ZIP_FILENAME);
      return;
    }
    if (assessment?.starterFilesGitHubLink) {
      window.open(
        assessment.starterFilesGitHubLink,
        "_blank",
        "noopener,noreferrer"
      );
    }
  };

  const enterSetup = () => {
    if (token) {
      try {
        sessionStorage.setItem(`${SETUP_STORAGE_PREFIX}${token}`, "1");
      } catch {
        /* private mode / blocked storage */
      }
    }
    setInSetup(true);
  };

  const clearSetup = () => {
    if (token) {
      try {
        sessionStorage.removeItem(`${SETUP_STORAGE_PREFIX}${token}`);
      } catch {
        /* ignore */
      }
    }
    setInSetup(false);
  };

  const handleStartClick = () => {
    if (!token) {
      alert("No token provided");
      return;
    }
    // No screen, capture-kit, or starters — nothing to set up. Start now.
    if (!needsWorkspaceSetup) {
      setIsStarting(true);
      doStartAssessment();
      return;
    }
    if (usesScreenRecording) {
      setShowConsent(true);
      return;
    }
    // Workflow-only (or starters with observation off): skip the screen
    // picker and go straight to the orientation screen. Do not start the
    // timer or hand over starter files yet.
    enterSetup();
  };

  const handleConsentGranted = async () => {
    setShowConsent(false);
    enterSetup();
    try {
      // Create proctoring session as soon as consent is granted so it exists even if capture fails
      const sessionResult = await createProctoringSession(token);
      if (sessionResult.success) {
        const sid = sessionResult.data._id;
        const subId = sessionResult.data.submissionId;
        setProctoringSessionId(sid);
        if (subId) setProctoringSubmissionId(subId);
        await grantConsent(sid, token, 1);
        proctoringStoppedRef.current = false;
        stopProctoringPromiseRef.current = null;
        setProctoringEnabled(true);
      }

      await screenCapture.startCapture();
    } catch (err) {
      console.error("Error starting screen capture or proctoring session:", err);
    }
  };

  const handleConsentBack = () => {
    setShowConsent(false);
  };

  const handleSetupShareScreen = async () => {
    try {
      // Replacing a window/tab share needs a fresh picker; stop first so
      // they aren't left recording the wrong surface.
      if (screenCapture.isSharing) {
        screenCapture.stopCapture();
      }
      const stream = await screenCapture.startCapture();
      if (!stream) return;
      if (!proctoringSessionId && token) {
        const sessionResult = await createProctoringSession(token);
        if (sessionResult.success) {
          const sid = sessionResult.data._id;
          const subId = sessionResult.data.submissionId;
          setProctoringSessionId(sid);
          if (subId) setProctoringSubmissionId(subId);
          await grantConsent(sid, token, 1);
          proctoringStoppedRef.current = false;
          stopProctoringPromiseRef.current = null;
          setProctoringEnabled(true);
        }
      }
    } catch (err) {
      console.error("Error starting screen share during setup:", err);
    }
  };

  const handleFinishSetup = () => {
    if (usesScreenRecording) {
      const hasValidShare =
        screenCapture.isSharingFullScreen ||
        (screenCapture.isSharing && !screenCapture.displaySurface);
      if (!hasValidShare) return;
    }
    triggerStarterDownload();
    setIsStarting(true);
    doStartAssessment();
  };

  const doStartAssessment = async () => {
    try {
      const result = await startAssessment(token);
      if (result.success) {
        clearSetup();
        setSubmission({
          ...result.data,
          evidenceMode: result.data.evidenceMode || submission?.evidenceMode,
        });
        setTimeRemaining(result.data.timeRemaining);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to start assessment";
        alert(errorMsg);
      }
    } catch (error) {
      console.error("Error starting assessment:", error);
      alert("Failed to start assessment");
    } finally {
      setIsStarting(false);
    }
  };

  const hasSubmissionReady = Boolean(githubUrl.trim() || uploadArchive);

  const handleArchiveReady = (archive, info) => {
    setUploadArchive(archive);
    setUploadArchiveInfo(info);
    setGithubUrl("");
  };

  const handleClearArchive = () => {
    setUploadArchive(null);
    setUploadArchiveInfo(null);
  };

  const handleGithubChange = (value) => {
    setGithubUrl(value);
    if (value.trim()) {
      setUploadArchive(null);
      setUploadArchiveInfo(null);
    }
  };

  const handleSubmit = async ({ allowAfterMainTimer = false } = {}) => {
    if (!githubUrl.trim() && !uploadArchive) {
      alert(
        "Please enter a GitHub repository URL or upload your project files"
      );
      return;
    }

    if (!token) {
      alert("No token provided");
      return;
    }

    if (hasMissedGracePeriod) {
      alert("Submission window has closed. You ran out of time.");
      return;
    }
    if (!allowAfterMainTimer && timeRemaining !== null && timeRemaining <= 0) {
      alert("Time is up. Please submit from the timeout popup.");
      return;
    }

    setIsSubmitting(true);
    try {
      await flushPendingCapture();

      const result = uploadArchive
        ? await uploadAssessmentArchive(token, uploadArchive)
        : await submitAssessment(token, githubUrl.trim());
      if (result.success) {
        await stopProctoringCapture();
        navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to submit assessment";
        if (
          typeof errorMsg === "string" &&
          errorMsg.toLowerCase().includes("submission window has closed")
        ) {
          setIsGracePeriodActive(false);
          setHasMissedGracePeriod(true);
          await stopProctoringCapture();
        } else {
          setRecorderEpoch((n) => n + 1);
        }
        alert(errorMsg);
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Error submitting assessment:", error);
      setRecorderEpoch((n) => n + 1);
      alert("Failed to submit assessment");
      setIsSubmitting(false);
    }
  };

  const handleOptOut = async () => {
    if (!token) {
      alert("No token provided");
      return;
    }

    setIsOptingOut(true);
    try {
      await flushPendingCapture();
      const result = await optOutAssessment(
        token,
        optOutReason.trim() || undefined
      );
      if (result.success) {
        await stopProctoringCapture();
        // Update local state to show opted out screen
        setSubmission(result.data);
        setShowOptOutModal(false);
        setOptOutReason("");
      } else {
        setRecorderEpoch((n) => n + 1);
        const errorMsg = "error" in result ? result.error : "Failed to opt out";
        alert(errorMsg);
        setIsOptingOut(false);
      }
    } catch (error) {
      console.error("Error opting out:", error);
      setRecorderEpoch((n) => n + 1);
      alert("Failed to opt out");
      setIsOptingOut(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#21201C]/30 border-t-[#21201C] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading assessment...</p>
        </div>
      </div>
    );
  }

  if (!submission || !assessment) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load assessment</p>
        </div>
      </div>
    );
  }

  // Show opted out screen if candidate has opted out
  if (submission.status === "opted-out") {
    const optedOutBeforeStarting = !submission.startedAt;

    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FAF9F2] to-[#F4F2E9] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-card border border-border shadow-[0_2px_18px_rgba(33,32,28,0.06)] overflow-hidden"
        >
          {/* Header */}
          <div className="bg-orange-500 px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4">
              <X className="w-10 h-10 text-orange-500" />
            </div>
            <h1 className="text-2xl font-medium tracking-[-0.012em] text-white mb-1">
              You Have Opted Out
            </h1>
            <p className="text-white/90">
              {optedOutBeforeStarting
                ? "You have chosen not to start this assessment"
                : "You have chosen not to complete this assessment"}
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                {assessment.title}
              </h2>
              {optedOutBeforeStarting ? (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-blue-800 font-medium">
                    ℹ️ You opted out before starting the assessment
                  </p>
                </div>
              ) : (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-orange-800 font-medium">
                    ⚠️ You opted out after starting the assessment
                  </p>
                </div>
              )}
              {submission.optOutReason && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Your reason:
                  </p>
                  <p className="text-sm text-gray-600">
                    {submission.optOutReason}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <p className="text-sm text-orange-800">
                <strong>Note:</strong>{" "}
                {optedOutBeforeStarting
                  ? "You opted out before starting the assessment. If you change your mind, please contact the assessment team."
                  : "You opted out after starting the assessment. If you change your mind, please contact the assessment team."}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const hasStarted =
    submission.status === "in-progress" ||
    submission.status === "submitted" ||
    submission.status === "expired";

  // Calculate time limit display
  const timeLimitHours = Math.floor(assessment.timeLimit / 60);
  const timeLimitMinutes = assessment.timeLimit % 60;
  const timeLimitDisplay =
    timeLimitHours > 0
      ? `${timeLimitHours} hour${timeLimitHours > 1 ? "s" : ""}${
          timeLimitMinutes > 0
            ? ` ${timeLimitMinutes} minute${timeLimitMinutes > 1 ? "s" : ""}`
            : ""
        }`
      : `${timeLimitMinutes} minute${timeLimitMinutes > 1 ? "s" : ""}`;
  const shouldGrayOut = isGracePeriodActive || hasMissedGracePeriod;
  const graceCountdownDisplay = formatHms(graceSecondsRemaining);

  const copyCaptureCommand = () => {
    navigator.clipboard
      ?.writeText(captureSetupCommand)
      .then(() => setCaptureCmdCopied(true))
      .catch(() => {});
  };

  const reshareModal =
    showResharePrompt && usesScreenRecording ? (
      <ResharePrompt
        required
        onReshare={handleReshare}
        title={reshareIsResume ? "Resume screen sharing" : undefined}
        subtitle={
          reshareIsResume
            ? hasStarted
              ? "Your session is still active — pick your entire screen again to continue recording."
              : "Your setup is still in progress — pick your entire screen again to continue recording."
            : undefined
        }
        body={
          reshareIsResume
            ? "After a page refresh the browser stops screen capture. Reshare your entire screen (full display), not a window or tab."
            : undefined
        }
      />
    ) : showResharePrompt ? (
      <ResharePrompt
        onReshare={handleReshare}
        onDismiss={() => {
          setShowResharePrompt(false);
          setReshareIsResume(false);
        }}
      />
    ) : null;

  const optOutModal = showOptOutModal ? (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
      >
        <h2 className="text-xl font-medium tracking-[-0.012em] text-gray-900 mb-2">
          Opt Out of Assessment
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Are you sure you want to opt out of this assessment? Please let us
          know why (optional):
        </p>
        <Textarea
          value={optOutReason}
          onChange={(e) => setOptOutReason(e.target.value)}
          placeholder="E.g., Time constraints, technical issues, not interested..."
          className="min-h-[100px] mb-4"
        />
        <div className="flex gap-3">
          <Button
            onClick={handleOptOut}
            disabled={isOptingOut}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          >
            {isOptingOut ? "Opting Out..." : "Confirm Opt Out"}
          </Button>
          <Button
            onClick={() => {
              setShowOptOutModal(false);
              setOptOutReason("");
            }}
            variant="outline"
            disabled={isOptingOut}
          >
            Cancel
          </Button>
        </div>
      </motion.div>
    </div>
  ) : null;

  if (!hasStarted && inSetup) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] relative">
        {proctoringEnabled && screenCapture.isSharing && (
          <RecordingIndicator streamCount={screenCapture.streams.length} />
        )}
        {reshareModal}
        <AssessmentSetup
          title={assessment.title}
          companyName={assessment.userId?.companyName}
          timeLimitDisplay={timeLimitDisplay}
          usesScreenRecording={usesScreenRecording}
          recordingSkipped={false}
          isSharing={screenCapture.isSharing}
          isSharingFullScreen={screenCapture.isSharingFullScreen}
          displaySurface={screenCapture.displaySurface}
          onShareScreen={handleSetupShareScreen}
          usesVoiceCheck={COMPANION_ENABLED && usesScreenRecording}
          hasStarterZip={hasStarterZip}
          hasStarterRepo={hasStarterRepo}
          usesWorkflowCapture={usesWorkflowCapture}
          isFinishing={isStarting}
          onFinishSetup={handleFinishSetup}
          onOptOut={() => setShowOptOutModal(true)}
        />
        {optOutModal}
      </div>
    );
  }

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FAF9F2] to-[#F4F2E9] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-card border border-border shadow-[0_2px_18px_rgba(33,32,28,0.06)] overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#21201C] px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4 overflow-hidden">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-2xl font-medium tracking-[-0.012em] text-white mb-1">
              {assessment.title}
            </h1>
            <p className="text-blue-200">Technical Assessment</p>
            {assessment.userId?.companyName && (
              <p className="text-blue-300 text-sm mt-2">
                From {assessment.userId.companyName}
              </p>
            )}
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Time Info */}
            <div className="flex items-center justify-center gap-6 mb-8 py-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-5 h-5 text-[#21201C]" />
                <span className="text-sm">
                  <strong>{timeLimitDisplay}</strong> to complete
                </span>
              </div>
            </div>

            {(hasStarterZip || hasStarterRepo) && (
              <div className="mb-6 p-4 bg-[#FAF9F2] border border-[#21201C]/15 rounded-xl">
                <h3 className="text-sm font-semibold text-[#21201C] mb-1">
                  You must start from the starter files
                </h3>
                <p className="text-sm text-gray-700">
                  {hasStarterZip ? (
                    <>
                      Starter files download when the assessment starts. Unzip{" "}
                      <code className="font-mono text-xs">starter-code.zip</code>{" "}
                      and work in that folder — don&apos;t begin from a blank
                      project.
                    </>
                  ) : (
                    <>
                      When the assessment starts, open the starter repository
                      and work from those files — don&apos;t begin from a blank
                      project.
                    </>
                  )}
                  {usesWorkflowCapture
                    ? " You will also run a short setup command from that folder after you start."
                    : ""}
                </p>
              </div>
            )}

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-6">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                {needsWorkspaceSetup ? (
                  <>
                    <strong>Next:</strong> share your entire screen. The timer
                    does not start — and you will not see the assignment or
                    starter files — until you start the assessment.
                  </>
                ) : (
                  <>
                    <strong>Important:</strong> Once you start, the timer
                    begins. You&apos;ll have {timeLimitDisplay} to complete and
                    submit your work.
                  </>
                )}
              </div>
            </div>

            {/* Start Button */}
            <Button
              onClick={handleStartClick}
              disabled={isStarting}
              className="w-full bg-[#21201C] hover:bg-[#35332D] text-white py-6 text-lg rounded-full disabled:opacity-50 mb-3"
            >
              <Play className="w-5 h-5 mr-2" />
              {isStarting
                ? "Starting..."
                : needsWorkspaceSetup
                  ? "Continue to setup"
                  : "Start Assessment"}
            </Button>

            {/* Opt Out Button */}
            <button
              onClick={() => setShowOptOutModal(true)}
              className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
            >
              I cannot complete this assessment
            </button>
          </div>
        </motion.div>

        {/* Consent Screen Overlay */}
        {showConsent && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <ConsentScreen
              onConsent={handleConsentGranted}
              onDecline={handleConsentBack}
              allowSkip={false}
              evidenceMode={evidenceMode}
            />
          </div>
        )}

        {optOutModal}
      </div>
    );
  }

  // Started state - show submission form
  return (
    <div className="min-h-screen bg-[#FAF9F2] relative">
      {/* Recording Indicator */}
      {proctoringEnabled && screenCapture.isSharing && (
        <RecordingIndicator streamCount={screenCapture.streams.length} />
      )}

      {/* In-session voice check-in (ElevenLabs) */}
      {companionMounted && (
        <ProctoringCompanionNotch
          ref={companionRef}
          sessionId={proctoringSessionId}
          token={token}
          submissionId={proctoringSubmissionId}
          reshareRequestId={companionReshareTick}
          shareRestoredRequestId={companionShareRestoredTick}
          screenShareLive={screenCapture.isSharing}
        />
      )}

      {reshareModal}

      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                {assessment.title}
              </h1>
              {assessment.userId?.companyName && (
                <p className="text-xs text-gray-500">
                  {assessment.userId.companyName}
                </p>
              )}
            </div>
          </div>
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              timeRemaining !== null && timeRemaining <= 15
                ? "bg-red-50 text-red-700"
                : timeRemaining !== null && timeRemaining <= 60
                ? "bg-yellow-50 text-yellow-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="font-mono font-semibold">
              {timeRemaining !== null ? timeDisplay : "00:00:00"}
            </span>
            <span className="text-sm">remaining</span>
          </div>
        </div>
      </div>

      {/* Extra bottom padding when the voice overlay is mounted, so it never
          sits on top of the submit / opt-out buttons at the end of the page. */}
      <div
        className={`max-w-4xl mx-auto px-6 py-8 ${
          companionMounted ? "pb-44" : ""
        }`}
      >
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            {(hasStarterZip || hasStarterRepo || usesWorkflowCapture) && (
              <div className="mb-6 rounded-xl border border-[#21201C] bg-[#FAF9F2] p-5">
                <h2 className="text-lg font-semibold text-[#21201C] mb-1">
                  Do this now
                </h2>
                <p className="text-sm text-gray-700 mb-4">
                  The timer is running. Set up your workspace, then read the
                  assignment below.
                </p>
                <ol className="space-y-3 text-sm text-gray-800">
                  {(hasStarterZip || hasStarterRepo) && (
                    <li>
                      <span className="font-semibold text-[#21201C]">
                        {hasStarterZip
                          ? "Unzip starter-code.zip and open that folder"
                          : "Open the starter repository"}
                      </span>
                      <p className="mt-1 text-gray-700">
                        Work from those files — not a blank project.
                        {hasStarterZip
                          ? " A zip should have downloaded when you started."
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {hasStarterZip && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={triggerStarterDownload}
                            className="h-9 px-3 text-xs"
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Download starter files again
                          </Button>
                        )}
                        {hasStarterRepo && (
                          <a
                            href={assessment.starterFilesGitHubLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#21201C] underline underline-offset-2"
                          >
                            <LinkIcon className="w-3.5 h-3.5" />
                            Starter repo on GitHub
                          </a>
                        )}
                      </div>
                    </li>
                  )}
                  {usesWorkflowCapture && (
                    <li>
                      <span className="font-semibold text-[#21201C]">
                        Run this from that folder
                      </span>
                      <p className="mt-1 mb-3 text-gray-700">
                        It shows exactly what is recorded and asks you to type
                        “agree” before anything is captured.
                      </p>
                      <CaptureSetupCommand
                        command={captureSetupCommand}
                        copied={captureCmdCopied}
                        onCopy={copyCaptureCommand}
                      />
                      <p className="mt-3 text-xs text-gray-600">
                        Then start Claude Code, Cursor, or Codex in the same
                        folder. The first time, it will ask you to trust the
                        folder — you must accept, or nothing is recorded.
                      </p>
                    </li>
                  )}
                </ol>
              </div>
            )}

            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Project Instructions
            </h2>
            <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              You&apos;re encouraged to work in your own development environment and use AI coding
              tools if you find them helpful.
            </p>

            <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className="mb-3">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside mb-3 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside mb-3 space-y-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="ml-2">{children}</li>,
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
                        {children}
                      </code>
                    ) : (
                      <code className="block bg-gray-100 text-gray-800 p-3 rounded text-sm font-mono overflow-x-auto mb-3">
                        {children}
                      </code>
                    );
                  },
                  strong: ({ children }) => (
                    <strong className="font-semibold text-gray-900">
                      {children}
                    </strong>
                  ),
                }}
              >
                {assessment.description}
              </ReactMarkdown>
            </div>

            {/* Starter code files (inline preview of the zip they downloaded) */}
            {assessment.starterCodeFiles?.length > 0 && (
              <div className="mt-6">
                <p className="text-xs text-gray-500 mb-2">
                  Preview of the starter files in{" "}
                  <code className="font-mono">starter-code.zip</code>
                </p>
                <StarterCodeIDE files={assessment.starterCodeFiles} readOnly={true} />
              </div>
            )}
          </motion.div>

          {/* Submission Form */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Submit Your Work
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  GitHub repository URL
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    value={githubUrl}
                    onChange={(e) => handleGithubChange(e.target.value)}
                    placeholder="https://github.com/username/repository"
                    className="pl-10"
                    disabled={Boolean(uploadArchive)}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Use a public repo URL, or ensure our systems can access a private repo you were
                  invited to. The latest commit on your default branch will be recorded.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium uppercase font-mono tracking-[0.03em] text-gray-400">
                  or
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload project files
                </label>
                <SubmissionFileDropzone
                  disabled={Boolean(githubUrl.trim()) || isSubmitting}
                  archiveInfo={uploadArchiveInfo}
                  onArchiveReady={handleArchiveReady}
                  onClear={handleClearArchive}
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Drag and drop your project folder or files. We&apos;ll package them into a zip
                  before upload.
                </p>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Please include any additional context,
                  notes about your approach, trade-offs made, or things you&apos;d
                  improve with more time in your README file.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => handleSubmit()}
                  disabled={
                    !hasSubmissionReady ||
                    isSubmitting ||
                    (timeRemaining !== null && timeRemaining <= 0)
                  }
                  className="flex-1 bg-[#21201C] hover:bg-[#35332D] text-white py-5 disabled:opacity-50"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmitting ? "Submitting..." : "Submit Assessment"}
                </Button>
                <Button
                  onClick={() => setShowOptOutModal(true)}
                  variant="outline"
                  disabled={shouldGrayOut}
                  className="px-4 py-5 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  <X className="w-4 h-4 mr-2" />
                  Opt Out
                </Button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Need Help Section - Bottom */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 bg-blue-50 rounded-xl border border-blue-100 p-5 text-center"
        >
          <h3 className="font-medium text-[#21201C] mb-2">Need Help?</h3>
          <p className="text-sm text-gray-600">
            If you encounter any technical issues, contact saaz@bridge-jobs.com
          </p>
        </motion.div>
      </div>

      {shouldGrayOut && (
        <div className="fixed inset-0 bg-gray-700/35 backdrop-grayscale z-40" />
      )}

      {(isGracePeriodActive || hasMissedGracePeriod) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-lg rounded-xl bg-white border border-gray-200 shadow-2xl p-6"
          >
            {!hasMissedGracePeriod ? (
              <>
                <h2 className="text-xl font-medium tracking-[-0.012em] text-gray-900 mb-2">
                  Time is up
                </h2>
                <p className="text-sm text-gray-700 mb-4">
                  Recording has stopped. You have one final 5-minute window to
                  submit your work.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <p className="text-xs uppercase font-mono tracking-[0.03em] text-amber-700 mb-1">
                    Grace Period Remaining
                  </p>
                  <p className="text-2xl font-mono font-medium tracking-[-0.012em] text-amber-900">
                    {graceCountdownDisplay}
                  </p>
                </div>
                <div className="mb-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      GitHub repository URL
                    </label>
                    <Input
                      value={githubUrl}
                      onChange={(e) => handleGithubChange(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      disabled={Boolean(uploadArchive)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span className="text-xs font-medium uppercase font-mono tracking-[0.03em] text-gray-400">
                      or
                    </span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>
                  <SubmissionFileDropzone
                    compact
                    disabled={Boolean(githubUrl.trim()) || isSubmitting}
                    archiveInfo={uploadArchiveInfo}
                    onArchiveReady={handleArchiveReady}
                    onClear={handleClearArchive}
                  />
                </div>
                <Button
                  onClick={() => handleSubmit({ allowAfterMainTimer: true })}
                  disabled={!hasSubmissionReady || isSubmitting}
                  className="w-full bg-[#21201C] hover:bg-[#35332D] text-white"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmitting ? "Submitting..." : "Submit in Final Window"}
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-medium tracking-[-0.012em] text-red-700 mb-2">
                  Time window closed
                </h2>
                <p className="text-sm text-gray-700">
                  You ran out of time, so we are submitting your screen
                  recording automatically.
                </p>
              </>
            )}
          </motion.div>
        </div>
      )}

      {!shouldGrayOut && optOutModal}
    </div>
  );
}
