import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE_URL } from "@/config/api";
import {
  getSessionBySubmission,
  getTranscriptContent,
  getProctoringVideoStreamUrl,
} from "@/api/proctoring";
import {
  shouldActivateRecordingLoader,
  isMergeInFlight,
  shouldFetchVideo,
  shouldReloadVideoOnMergeComplete,
  planRecordingLoads,
  parseTranscriptJsonl,
  normalizeSessionId,
  buildVideoStreamSrc,
} from "@/lib/proctoringRecordingLoader";
import { getSteadyWriterPreloadedVideoUrl, isSteadyWriterSubmission } from "@/lib/steadyWriterDemo";

const MERGE_POLL_MS = 4000;

/**
 * Manages proctoring session, buffered video stream URL, and transcript for the
 * Recording & rubric tab. Caches per submission across tab switches within the modal.
 */
export function useProctoringRecording({
  submissionId,
  evaluationTab,
  showEvaluationModal,
  currentUser,
  evaluationReport,
  enrichedTranscript,
  prefetchOnModalOpen = false,
}) {
  const cacheRef = useRef(new Map());
  const mergePollRef = useRef(null);
  const prevMergeStatusRef = useRef(null);
  const evaluationReportRef = useRef(evaluationReport);
  const enrichedTranscriptRef = useRef(enrichedTranscript);

  evaluationReportRef.current = evaluationReport;
  enrichedTranscriptRef.current = enrichedTranscript;

  const [recordingSession, setRecordingSession] = useState(null);
  const [recordingSessionLoading, setRecordingSessionLoading] = useState(false);
  const [recordingTranscript, setRecordingTranscript] = useState(null);
  const [recordingTranscriptLoading, setRecordingTranscriptLoading] =
    useState(false);
  const [recordingVideoLoading, setRecordingVideoLoading] = useState(false);
  const [recordingTranscriptError, setRecordingTranscriptError] =
    useState(null);
  const [recordingVideoError, setRecordingVideoError] = useState(null);
  const [recordingVideoUrl, setRecordingVideoUrl] = useState(null);

  const updateCache = useCallback((subId, partial) => {
    const prev = cacheRef.current.get(subId) || { submissionId: subId };
    cacheRef.current.set(subId, { ...prev, submissionId: subId, ...partial });
  }, []);

  const clearMergePoll = useCallback(() => {
    if (mergePollRef.current) {
      clearInterval(mergePollRef.current);
      mergePollRef.current = null;
    }
  }, []);

  const loadVideoStream = useCallback(
    async (sessionId, token, subId) => {
      setRecordingVideoLoading(true);
      setRecordingVideoError(null);
      try {
        const videoResult = await getProctoringVideoStreamUrl(sessionId, token);
        if (videoResult.success && videoResult.data) {
          const streamUrl = buildVideoStreamSrc(videoResult.data, API_BASE_URL);
          setRecordingVideoUrl(streamUrl);
          updateCache(subId, { videoUrl: streamUrl, videoError: null });
        } else {
          const message = videoResult.error ?? "Failed to load video stream";
          setRecordingVideoError(message);
          updateCache(subId, { videoError: message });
        }
      } catch (err) {
        const message = err?.message ?? "Failed to load video stream";
        setRecordingVideoError(message);
        updateCache(subId, { videoError: message });
      } finally {
        setRecordingVideoLoading(false);
      }
    },
    [updateCache]
  );

  const loadTranscript = useCallback(
    async (sessionId, subId) => {
      setRecordingTranscriptLoading(true);
      setRecordingTranscriptError(null);
      try {
        const transcriptResult = await getTranscriptContent(sessionId);
        if (transcriptResult.success && transcriptResult.data) {
          const segments = parseTranscriptJsonl(transcriptResult.data);
          setRecordingTranscript(segments);
          updateCache(subId, { transcript: segments, transcriptError: null });
        }
      } catch (err) {
        const message = err?.message ?? "Failed to load screen transcript";
        setRecordingTranscriptError(message);
        updateCache(subId, { transcriptError: message });
      } finally {
        setRecordingTranscriptLoading(false);
      }
    },
    [updateCache]
  );

  const refreshVideoStream = useCallback(async () => {
    if (!submissionId || !currentUser || !recordingSession) return;
    const sessionId = normalizeSessionId(recordingSession);
    if (!sessionId) return;
    const token = await currentUser.getIdToken();
    await loadVideoStream(sessionId, token, submissionId);
  }, [submissionId, currentUser, recordingSession, loadVideoStream]);

  // Reset when evaluation modal closes
  useEffect(() => {
    if (!showEvaluationModal) {
      clearMergePoll();
      cacheRef.current.clear();
      prevMergeStatusRef.current = null;
      setRecordingSession(null);
      setRecordingSessionLoading(false);
      setRecordingTranscript(null);
      setRecordingVideoUrl(null);
      setRecordingTranscriptError(null);
      setRecordingVideoError(null);
      setRecordingTranscriptLoading(false);
      setRecordingVideoLoading(false);
    }
  }, [showEvaluationModal, clearMergePoll]);

  // Primary loader: active only on Recording tab
  useEffect(() => {
    if (
      !shouldActivateRecordingLoader({
        showEvaluationModal,
        evaluationTab,
        submissionId,
        currentUser,
        prefetchOnModalOpen,
      })
    ) {
      return;
    }

    const report = evaluationReportRef.current;
    const hasEnrichedTranscript = Boolean(enrichedTranscriptRef.current);

    const cached = cacheRef.current.get(submissionId);
    const steadyWriterPreload =
      isSteadyWriterSubmission(submissionId) ?
        getSteadyWriterPreloadedVideoUrl()
      : null;

    if (!cached?.session && !cached?.videoUrl && !steadyWriterPreload) {
      setRecordingSessionLoading(true);
    }

    if (cached || steadyWriterPreload) {
      setRecordingSession(cached?.session ?? null);
      setRecordingVideoUrl(cached?.videoUrl ?? steadyWriterPreload ?? null);
      setRecordingTranscript(cached?.transcript ?? null);
      setRecordingTranscriptError(cached?.transcriptError ?? null);
      setRecordingVideoError(cached?.videoError ?? null);
      if (steadyWriterPreload && !cached?.videoUrl) {
        updateCache(submissionId, { videoUrl: steadyWriterPreload });
      }
      if (
        cached?.session &&
        !isMergeInFlight(cached.session) &&
        (cached.videoUrl ||
          steadyWriterPreload ||
          !shouldFetchVideo({
            session: cached.session,
            evaluationReport: report,
            cachedVideoUrl: cached.videoUrl ?? steadyWriterPreload,
          }))
      ) {
        return;
      }
    }

    let cancelled = false;
    clearMergePoll();
    if (!cached?.session) {
      setRecordingSessionLoading(true);
    }

    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const sessionResult = await getSessionBySubmission(submissionId, token);
        if (cancelled) return;

        if (!sessionResult.success || !sessionResult.data) {
          setRecordingSessionLoading(false);
          setRecordingTranscriptLoading(false);
          return;
        }

        const session = sessionResult.data;
        if (String(session.submissionId) !== String(submissionId)) {
          setRecordingSessionLoading(false);
          setRecordingTranscriptLoading(false);
          return;
        }

        setRecordingSession(session);
        setRecordingSessionLoading(false);
        updateCache(submissionId, { session });

        const plan = planRecordingLoads({
          session,
          evaluationReport: report,
          hasEnrichedTranscript,
          cache: cached,
          submissionId,
        });

        const sessionId = normalizeSessionId(session);

        if (plan.useCachedTranscript && cached?.transcript) {
          setRecordingTranscript(cached.transcript);
        } else if (plan.fetchTranscript && sessionId) {
          loadTranscript(sessionId, submissionId).catch(() => {});
        }

        if (plan.useCachedVideo && cached?.videoUrl) {
          setRecordingVideoUrl(cached.videoUrl);
        } else if (plan.fetchVideo && sessionId) {
          loadVideoStream(sessionId, token, submissionId).catch(() => {});
        }

        if (!cancelled && isMergeInFlight(session)) {
          mergePollRef.current = setInterval(async () => {
            if (cancelled) return;
            try {
              const tok = await currentUser.getIdToken();
              const sr = await getSessionBySubmission(submissionId, tok);
              if (!sr.success || !sr.data || cancelled) return;

              const prevCached = cacheRef.current.get(submissionId);
              const prevSession = prevCached?.session;

              setRecordingSession(sr.data);
              updateCache(submissionId, { session: sr.data });

              if (!isMergeInFlight(sr.data)) {
                clearMergePoll();
                const sid = normalizeSessionId(sr.data);
                if (
                  sid &&
                  shouldFetchVideo({
                    session: sr.data,
                    evaluationReport: evaluationReportRef.current,
                    cachedVideoUrl: cacheRef.current.get(submissionId)?.videoUrl,
                    mergeJustCompleted: shouldReloadVideoOnMergeComplete(
                      prevSession,
                      sr.data
                    ),
                  })
                ) {
                  await loadVideoStream(sid, tok, submissionId);
                }
              }
            } catch {
              // ignore poll errors
            }
          }, MERGE_POLL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setRecordingTranscriptError(
            err?.message ?? "Failed to load recording"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      setRecordingSessionLoading(false);
      clearMergePoll();
    };
  }, [
    showEvaluationModal,
    evaluationTab,
    submissionId,
    currentUser,
    prefetchOnModalOpen,
    clearMergePoll,
    loadTranscript,
    loadVideoStream,
    updateCache,
  ]);

  // Track merge status transitions for video reload without full effect re-run
  useEffect(() => {
    const status = recordingSession?.mergedVideo?.status ?? null;
    prevMergeStatusRef.current = status;
  }, [recordingSession?.mergedVideo?.status]);

  return {
    recordingSession,
    recordingSessionLoading,
    recordingTranscript,
    recordingTranscriptLoading,
    recordingVideoLoading,
    recordingTranscriptError,
    recordingVideoError,
    recordingVideoUrl,
    refreshVideoStream,
  };
}
