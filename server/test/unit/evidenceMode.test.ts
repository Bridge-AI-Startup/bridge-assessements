import { describe, expect, it } from "vitest";

import {
  resolveEvidenceMode,
  shouldCaptureScreen,
  shouldCaptureWorkflow,
  shouldEvaluateWorkflow,
  shouldGenerateVideoTranscript,
} from "../../src/utils/evidenceMode.js";

describe("resolveEvidenceMode", () => {
  it("treats a missing field as legacy screen recording", () => {
    expect(resolveEvidenceMode({})).toBe("screen");
    expect(resolveEvidenceMode(null)).toBe("screen");
    expect(resolveEvidenceMode(undefined)).toBe("screen");
    expect(resolveEvidenceMode({ evidenceMode: "nope" })).toBe("screen");
  });

  it("returns the assessment field as-is, including none and leftover screen", () => {
    expect(resolveEvidenceMode({ evidenceMode: "none" })).toBe("none");
    expect(resolveEvidenceMode({ evidenceMode: "screen" })).toBe("screen");
    expect(resolveEvidenceMode({ evidenceMode: "workflow" })).toBe("workflow");
    expect(resolveEvidenceMode({ evidenceMode: "both" })).toBe("both");
  });

  it("does not rewrite workflow/both based on WORKFLOW_CAPTURE_ENABLED", () => {
    const original = process.env.WORKFLOW_CAPTURE_ENABLED;
    try {
      delete process.env.WORKFLOW_CAPTURE_ENABLED;
      expect(resolveEvidenceMode({ evidenceMode: "workflow" })).toBe("workflow");
      expect(resolveEvidenceMode({ evidenceMode: "both" })).toBe("both");
      process.env.WORKFLOW_CAPTURE_ENABLED = "false";
      expect(resolveEvidenceMode({ evidenceMode: "workflow" })).toBe("workflow");
      expect(resolveEvidenceMode({ evidenceMode: "both" })).toBe("both");
    } finally {
      if (original === undefined) {
        delete process.env.WORKFLOW_CAPTURE_ENABLED;
      } else {
        process.env.WORKFLOW_CAPTURE_ENABLED = original;
      }
    }
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
