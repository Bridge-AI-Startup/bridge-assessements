import { describe, expect, it } from "vitest";
import {
  buildVideoStreamSrc,
  isBlobVideoUrl,
  planRecordingLoads,
  shouldActivateRecordingLoader,
  shouldFetchVideo,
  shouldReloadVideoOnSubmissionPatch,
  toSameOriginMediaUrl,
} from "../../src/lib/proctoringRecordingLoader.js";
import {
  STEADY_WRITER_DEMO,
  steadyWriterPlaybackStreamUrl,
  steadyWriterProctoringSession,
} from "../../src/lib/steadyWriterDemo.js";

describe("Steady writer demo — video buffer loading", () => {
  const session = steadyWriterProctoringSession();
  const evaluationReport = {
    criteria_results: [{ criterion: "Incremental build", score: 9, evaluable: true }],
    session_summary: "Steady writer demo evaluation",
  };

  it("activates loader on Recording tab for the steady writer submission", () => {
    expect(
      shouldActivateRecordingLoader({
        showEvaluationModal: true,
        evaluationTab: "recording",
        submissionId: STEADY_WRITER_DEMO.submissionId,
        currentUser: { uid: "firebase-demo" },
      })
    ).toBe(true);
  });

  it("prefetches demo video as soon as the evaluation modal opens", () => {
    expect(
      shouldActivateRecordingLoader({
        showEvaluationModal: true,
        evaluationTab: "execution",
        submissionId: STEADY_WRITER_DEMO.submissionId,
        currentUser: { uid: "firebase-demo" },
        prefetchOnModalOpen: true,
      })
    ).toBe(true);
  });

  it("uses direct HTTP stream URL (not blob) for the 31-minute steady writer recording", () => {
    const streamUrl = buildVideoStreamSrc(
      steadyWriterPlaybackStreamUrl(),
      "http://localhost:5050/api"
    );
    expect(streamUrl).toContain(STEADY_WRITER_DEMO.sessionId);
    expect(streamUrl).toContain("/playback-video?pt=");
    expect(isBlobVideoUrl(streamUrl)).toBe(false);
  });

  it("plans parallel video + transcript loads for steady writer session", () => {
    const plan = planRecordingLoads({
      session,
      evaluationReport,
      hasEnrichedTranscript: false,
      cache: null,
      submissionId: STEADY_WRITER_DEMO.submissionId,
    });
    expect(plan.fetchVideo).toBe(true);
    expect(plan.fetchTranscript).toBe(true);
    expect(plan.useCachedVideo).toBe(false);
  });

  it("reuses cached stream URL without re-fetching the large steady writer file", () => {
    const cachedUrl = steadyWriterPlaybackStreamUrl("cached-token");
    const plan = planRecordingLoads({
      session,
      evaluationReport,
      hasEnrichedTranscript: false,
      cache: {
        submissionId: STEADY_WRITER_DEMO.submissionId,
        session,
        videoUrl: cachedUrl,
      },
      submissionId: STEADY_WRITER_DEMO.submissionId,
    });
    expect(plan.fetchVideo).toBe(false);
    expect(plan.useCachedVideo).toBe(true);
    expect(plan.fetchTranscript).toBe(true);
  });

  it("does not reload video when steady writer behavioral grading progress updates", () => {
    expect(
      shouldReloadVideoOnSubmissionPatch(
        {
          _id: STEADY_WRITER_DEMO.submissionId,
          candidateName: STEADY_WRITER_DEMO.candidateName,
          behavioralGradingStatus: "pending",
          behavioralGradingProgress: { phase: "judge", checkIndex: 2 },
        },
        {
          _id: STEADY_WRITER_DEMO.submissionId,
          candidateName: STEADY_WRITER_DEMO.candidateName,
          behavioralGradingStatus: "pending",
          behavioralGradingProgress: { phase: "judge", checkIndex: 5 },
        }
      )
    ).toBe(false);
    expect(
      shouldFetchVideo({
        session,
        evaluationReport,
        cachedVideoUrl: steadyWriterPlaybackStreamUrl("cached"),
      })
    ).toBe(false);
  });

  it("rewrites steady writer playback URL to same-origin in local dev", () => {
    const original = steadyWriterPlaybackStreamUrl();
    const previousWindow = globalThis.window;
    globalThis.window = {
      location: { hostname: "localhost", origin: "http://localhost:5173" },
    };
    try {
      Object.defineProperty(globalThis, "import", {
        value: { meta: { env: { DEV: true } } },
        configurable: true,
      });
      const rewritten = toSameOriginMediaUrl(original);
      expect(rewritten).toBe(
        `http://localhost:5173/api/proctoring/sessions/${STEADY_WRITER_DEMO.sessionId}/playback-video?pt=steady-demo-token`
      );
      expect(isBlobVideoUrl(rewritten)).toBe(false);
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
