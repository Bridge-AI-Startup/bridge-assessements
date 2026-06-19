import { describe, expect, it } from "vitest";
import {
  buildVideoStreamSrc,
  isBlobVideoUrl,
  planRecordingLoads,
  shouldFetchVideo,
  shouldReloadVideoOnSubmissionPatch,
} from "../../src/lib/proctoringRecordingLoader.js";

const baseSession = {
  _id: "sess1",
  status: "completed",
  mergedVideo: { status: "ready" },
  transcript: { status: "completed", storageKey: "t.jsonl" },
};

describe("proctoringRecordingLoader", () => {
  describe("buffered loading", () => {
    it("buildVideoStreamSrc returns direct HTTP URL, not blob", () => {
      const url = buildVideoStreamSrc(
        "http://localhost:5050/api/proctoring/sessions/s1/playback-video?pt=abc",
        "http://localhost:5050/api"
      );
      expect(url).toMatch(/^https?:\/\//);
      expect(isBlobVideoUrl(url)).toBe(false);
    });

    it("rejects blob URLs as stream sources", () => {
      expect(isBlobVideoUrl("blob:http://localhost/abc")).toBe(true);
      expect(isBlobVideoUrl("http://localhost/video.webm")).toBe(false);
    });
  });

  describe("parallel loading", () => {
    it("plans independent video and transcript fetches", () => {
      const plan = planRecordingLoads({
        session: baseSession,
        evaluationReport: { criteria_results: [] },
        hasEnrichedTranscript: false,
        cache: null,
        submissionId: "sub1",
      });
      expect(plan.fetchVideo).toBe(true);
      expect(plan.fetchTranscript).toBe(true);
    });

    it("skips video fetch when cached stream URL exists", () => {
      const plan = planRecordingLoads({
        session: baseSession,
        evaluationReport: null,
        hasEnrichedTranscript: false,
        cache: {
          submissionId: "sub1",
          videoUrl: "http://localhost:5050/api/proctoring/sessions/sess1/playback-video?pt=x",
        },
        submissionId: "sub1",
      });
      expect(plan.fetchVideo).toBe(false);
      expect(plan.useCachedVideo).toBe(true);
    });
  });

  describe("transcript separate from video", () => {
    it("fetches transcript even when video is cached", () => {
      const plan = planRecordingLoads({
        session: baseSession,
        evaluationReport: null,
        hasEnrichedTranscript: false,
        cache: {
          submissionId: "sub1",
          videoUrl: "http://localhost:5050/api/proctoring/sessions/sess1/playback-video?pt=x",
        },
        submissionId: "sub1",
      });
      expect(plan.fetchTranscript).toBe(true);
      expect(plan.fetchVideo).toBe(false);
    });

    it("fetches video even when enriched transcript bypasses OCR transcript", () => {
      const plan = planRecordingLoads({
        session: baseSession,
        evaluationReport: { criteria_results: [] },
        hasEnrichedTranscript: true,
        cache: null,
        submissionId: "sub1",
      });
      expect(plan.fetchVideo).toBe(true);
      expect(plan.fetchTranscript).toBe(false);
    });

    it("shouldFetchVideo ignores behavioral-only submission patches", () => {
      expect(
        shouldReloadVideoOnSubmissionPatch(
          { _id: "sub1", behavioralGradingStatus: "pending" },
          { _id: "sub1", behavioralGradingStatus: "completed" }
        )
      ).toBe(false);
    });

    it("shouldFetchVideo returns false when cached URL present", () => {
      expect(
        shouldFetchVideo({
          session: baseSession,
          evaluationReport: null,
          cachedVideoUrl: "http://example.com/v.webm",
        })
      ).toBe(false);
    });
  });
});
