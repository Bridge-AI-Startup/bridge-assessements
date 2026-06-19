/**
 * Steady writer VP demo candidate (stress-demo fixture).
 * 31-minute screen recording — primary demo playback case.
 */
export const STEADY_WRITER_DEMO = {
  candidateName: "Steady writer",
  submissionId: "6a30cb825c1e8969b7c21114",
  sessionId: "6a30cb825c1e8969b7c21117",
  durationSeconds: 1860,
};

export function isSteadyWriterSubmission(submissionId) {
  if (!submissionId) return false;
  return String(submissionId) === STEADY_WRITER_DEMO.submissionId;
}

/** Shared across dashboard preload + recording modal. */
export const steadyWriterPreloadCache = {
  videoUrl: null,
  inFlight: null,
};

export function getSteadyWriterPreloadedVideoUrl() {
  return steadyWriterPreloadCache.videoUrl;
}

export function steadyWriterProctoringSession() {
  return {
    _id: STEADY_WRITER_DEMO.sessionId,
    submissionId: STEADY_WRITER_DEMO.submissionId,
    status: "completed",
    mergedVideo: {
      status: "ready",
      storageKey: `${STEADY_WRITER_DEMO.sessionId}/playback.webm`,
      durationSeconds: STEADY_WRITER_DEMO.durationSeconds,
    },
    transcript: {
      status: "completed",
      storageKey: `${STEADY_WRITER_DEMO.sessionId}/transcript.jsonl`,
    },
  };
}

export function steadyWriterPlaybackStreamUrl(playbackToken = "steady-demo-token") {
  return `http://localhost:5050/api/proctoring/sessions/${STEADY_WRITER_DEMO.sessionId}/playback-video?pt=${encodeURIComponent(playbackToken)}`;
}
