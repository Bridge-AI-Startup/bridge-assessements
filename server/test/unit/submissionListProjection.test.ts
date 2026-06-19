import { describe, expect, it } from "vitest";
import {
  buildSubmissionListAggregationPipeline,
  stripSubmissionForListView,
} from "../../src/utils/submissionListProjection.js";

describe("submissionListProjection", () => {
  it("does not strip behavioralGradingProgress from list aggregation unset", () => {
    const pipeline = buildSubmissionListAggregationPipeline(
      "507f1f77bcf86cd799439011"
    );
    const unsetStage = pipeline.find(
      (stage) => "$unset" in stage
    ) as { $unset: string[] } | undefined;
    expect(unsetStage?.$unset).not.toContain("behavioralGradingProgress");
  });

  it("retains behavioralGradingProgress in stripSubmissionForListView", () => {
    const progress = {
      phase: "judge",
      phaseLabel: "Agent judge — check 1 of 8",
      checksTotal: 8,
      completedChecks: [],
    };
    const trimmed = stripSubmissionForListView({
      _id: "507f1f77bcf86cd799439011",
      behavioralGradingStatus: "pending",
      behavioralGradingProgress: progress,
      screenRecordingTranscript: { huge: true },
    });
    expect(trimmed.behavioralGradingProgress).toEqual(progress);
    expect(trimmed.screenRecordingTranscript).toBeUndefined();
  });
});
