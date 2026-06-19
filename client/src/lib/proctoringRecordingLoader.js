/**
 * Pure orchestration helpers for proctoring recording loads.
 * Testable without React or network I/O.
 */

export function isRecordingTabActive(evaluationTab) {
  return evaluationTab === "recording";
}

export function shouldActivateRecordingLoader({
  showEvaluationModal,
  evaluationTab,
  submissionId,
  currentUser,
  prefetchOnModalOpen = false,
}) {
  if (!showEvaluationModal || !submissionId || !currentUser) return false;
  if (prefetchOnModalOpen) return true;
  return isRecordingTabActive(evaluationTab);
}

export function employerCanWatchRecording({ evaluationReport, session }) {
  return (
    Boolean(evaluationReport) ||
    session?.status === "completed" ||
    session?.mergedVideo?.status === "ready"
  );
}

export function isMergeInFlight(session) {
  return session?.mergedVideo?.status === "merging";
}

export function shouldFetchTranscript({ session, hasEnrichedTranscript }) {
  return (
    session?.transcript?.status === "completed" &&
    Boolean(session?.transcript?.storageKey) &&
    !hasEnrichedTranscript
  );
}

/**
 * Whether a new video stream URL should be requested.
 * Cached URLs are reused unless merge just completed.
 */
export function shouldFetchVideo({
  session,
  evaluationReport,
  cachedVideoUrl,
  mergeJustCompleted = false,
}) {
  if (!employerCanWatchRecording({ evaluationReport, session })) return false;
  if (isMergeInFlight(session)) return false;
  if (cachedVideoUrl && !mergeJustCompleted) return false;
  return true;
}

/**
 * Behavioral polling patches should not trigger video reload.
 */
export function shouldReloadVideoOnSubmissionPatch(prev, next) {
  if (!prev?._id || !next?._id) return false;
  if (prev._id !== next._id) return true;
  return false;
}

export function shouldReloadVideoOnMergeComplete(prevSession, nextSession) {
  const prevStatus = prevSession?.mergedVideo?.status;
  const nextStatus = nextSession?.mergedVideo?.status;
  return prevStatus === "merging" && nextStatus === "ready";
}

/**
 * Plan which resources to load after session metadata is available.
 */
export function planRecordingLoads({
  session,
  evaluationReport,
  hasEnrichedTranscript,
  cache,
  submissionId,
}) {
  const cached =
    cache?.submissionId === submissionId ? cache : null;

  const fetchTranscript =
    shouldFetchTranscript({ session, hasEnrichedTranscript }) &&
    !cached?.transcript;

  const fetchVideo = shouldFetchVideo({
    session,
    evaluationReport,
    cachedVideoUrl: cached?.videoUrl,
  });

  return {
    fetchTranscript,
    fetchVideo,
    useCachedSession: Boolean(cached?.session),
    useCachedTranscript: Boolean(cached?.transcript),
    useCachedVideo: Boolean(cached?.videoUrl) && !fetchVideo,
  };
}

/**
 * Build a direct HTTP stream URL for <video src> (not a blob: URL).
 */
export function buildVideoStreamSrc(serverUrl, apiBaseUrl) {
  if (!serverUrl || typeof serverUrl !== "string") return null;
  if (serverUrl.startsWith("http://") || serverUrl.startsWith("https://")) {
    return toSameOriginMediaUrl(serverUrl);
  }
  const base = (apiBaseUrl || "").replace(/\/$/, "");
  const path = serverUrl.startsWith("/") ? serverUrl : `/${serverUrl}`;
  return toSameOriginMediaUrl(`${base}${path}`);
}

/**
 * Rewrite API host to the current page origin so <video> Range requests are same-origin.
 * Only applied in local dev where Vite proxies `/api` → backend.
 */
export function toSameOriginMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (typeof window === "undefined") return url;

  const isLocalDev =
    typeof import.meta !== "undefined" &&
    import.meta.env?.DEV &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  if (!isLocalDev) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    return `${window.location.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function isBlobVideoUrl(url) {
  return typeof url === "string" && url.startsWith("blob:");
}

export function parseTranscriptJsonl(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split("\n").filter((l) => l.trim());
  return lines
    .map((line) => {
      try {
        const cleaned = line
          .trim()
          .replace(/^```(?:json|jsonl)?/, "")
          .replace(/^```$/, "")
          .trim();
        return cleaned ? JSON.parse(cleaned) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function normalizeSessionId(session) {
  if (!session?._id) return null;
  const id = session._id;
  if (typeof id === "string") return id;
  if (typeof id.toString === "function") return id.toString();
  return String(id);
}
