/**
 * Steady writer stress-demo candidate (from demo-stress-results.steady.json).
 * 31-minute screen recording — the primary VP demo playback stress case.
 */
export const STEADY_WRITER_DEMO = {
  candidateName: "Steady writer",
  candidateEmail: "steady@stress.bridgeai-demo.com",
  assessmentId: "6a30cb825c1e8969b7c21110",
  submissionId: "6a30cb825c1e8969b7c21114",
  sessionId: "6a30cb825c1e8969b7c21117",
  employerUserId: "6a30759984c34d799cfd9370",
  durationSeconds: 1860,
  frames: 1031,
  playbackStorageKey: "6a30cb825c1e8969b7c21117/playback.webm",
  /** ~500 MB — realistic merged WebM size for a 31 min session */
  estimatedPlaybackBytes: 524_288_000,
} as const;

export function steadyWriterProctoringSession() {
  return {
    _id: STEADY_WRITER_DEMO.sessionId,
    submissionId: STEADY_WRITER_DEMO.submissionId,
    status: "completed" as const,
    mergedVideo: {
      status: "ready" as const,
      storageKey: STEADY_WRITER_DEMO.playbackStorageKey,
      durationSeconds: STEADY_WRITER_DEMO.durationSeconds,
      sizeBytes: STEADY_WRITER_DEMO.estimatedPlaybackBytes,
    },
    transcript: {
      status: "completed" as const,
      storageKey: `${STEADY_WRITER_DEMO.sessionId}/transcript.jsonl`,
    },
  };
}
