import { afterEach, describe, expect, it } from "vitest";

import {
  resolveEvidenceMode,
  shouldCaptureScreen,
  shouldCaptureWorkflow,
  shouldEvaluateWorkflow,
  shouldGenerateVideoTranscript,
} from "../../src/utils/evidenceMode.js";

describe("resolveEvidenceMode", () => {
  const original = process.env.WORKFLOW_CAPTURE_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.WORKFLOW_CAPTURE_ENABLED;
    } else {
      process.env.WORKFLOW_CAPTURE_ENABLED = original;
    }
  });

  it("treats a missing field as legacy screen recording", () => {
    expect(resolveEvidenceMode({})).toBe("screen");
    expect(resolveEvidenceMode(null)).toBe("screen");
  });

  it("keeps none even when workflow capture is off", () => {
    process.env.WORKFLOW_CAPTURE_ENABLED = "false";
    expect(resolveEvidenceMode({ evidenceMode: "none" })).toBe("none");
  });

  it("keeps screen regardless of the master switch", () => {
    process.env.WORKFLOW_CAPTURE_ENABLED = "true";
    expect(resolveEvidenceMode({ evidenceMode: "screen" })).toBe("screen");
    process.env.WORKFLOW_CAPTURE_ENABLED = "false";
    expect(resolveEvidenceMode({ evidenceMode: "screen" })).toBe("screen");
  });

  it("returns workflow and both when the master switch is on", () => {
    process.env.WORKFLOW_CAPTURE_ENABLED = "true";
    expect(resolveEvidenceMode({ evidenceMode: "workflow" })).toBe("workflow");
    expect(resolveEvidenceMode({ evidenceMode: "both" })).toBe("both");
  });

  it("falls workflow and both back to screen when capture is off", () => {
    process.env.WORKFLOW_CAPTURE_ENABLED = "false";
    expect(resolveEvidenceMode({ evidenceMode: "workflow" })).toBe("screen");
    expect(resolveEvidenceMode({ evidenceMode: "both" })).toBe("screen");
  });
});

describe("evidence mode helpers", () => {
  it("asks for the screen only in screen and both", () => {
    expect(shouldCaptureScreen("none")).toBe(false);
    expect(shouldCaptureScreen("workflow")).toBe(false);
    expect(shouldCaptureScreen("both")).toBe(true);
    expect(shouldCaptureScreen("screen")).toBe(true);
  });

  it("asks for capture-kit only in workflow and both", () => {
    expect(shouldCaptureWorkflow("none")).toBe(false);
    expect(shouldCaptureWorkflow("workflow")).toBe(true);
    expect(shouldCaptureWorkflow("both")).toBe(true);
    expect(shouldCaptureWorkflow("screen")).toBe(false);
  });

  it("transcribes video only for legacy screen mode", () => {
    expect(shouldGenerateVideoTranscript("none")).toBe(false);
    expect(shouldGenerateVideoTranscript("workflow")).toBe(false);
    expect(shouldGenerateVideoTranscript("both")).toBe(false);
    expect(shouldGenerateVideoTranscript("screen")).toBe(true);
  });

  it("grades the hook stream only in workflow and both", () => {
    expect(shouldEvaluateWorkflow("none")).toBe(false);
    expect(shouldEvaluateWorkflow("workflow")).toBe(true);
    expect(shouldEvaluateWorkflow("both")).toBe(true);
    expect(shouldEvaluateWorkflow("screen")).toBe(false);
  });
});
