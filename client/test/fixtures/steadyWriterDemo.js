/**
 * Steady writer stress-demo candidate (from demo-stress-results.steady.json).
 */
export const STEADY_WRITER_DEMO = {
  candidateName: "Steady writer",
  candidateEmail: "steady@stress.bridgeai-demo.com",
  assessmentId: "6a30cb825c1e8969b7c21110",
  submissionId: "6a30cb825c1e8969b7c21114",
  sessionId: "6a30cb825c1e8969b7c21117",
  durationSeconds: 1860,
  playbackStorageKey: "6a30cb825c1e8969b7c21117/playback.webm",
};

export function steadyWriterProctoringSession() {
  return {
    _id: STEADY_WRITER_DEMO.sessionId,
    submissionId: STEADY_WRITER_DEMO.submissionId,
    status: "completed",
    mergedVideo: {
      status: "ready",
      storageKey: STEADY_WRITER_DEMO.playbackStorageKey,
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
