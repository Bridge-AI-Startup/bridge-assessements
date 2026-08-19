import { describe, expect, it } from "vitest";

import {
  resolveEvidenceMode,
  shouldCaptureScreen,
  shouldCaptureWorkflow,
  shouldEvaluateWorkflow,
} from "../../src/utils/evidenceMode.js";

describe("resolveEvidenceMode", () => {
  /**
   * The removed "screen" mode used to be the fallback here, which quietly made
   * the deprecated video-OCR path the default for every document predating the
   * field. Falling back to "both" is what moves those assessments onto the
   * current method without a data migration.
   */
  it("resolves a missing or unrecognised field to both", () => {
    expect(resolveEvidenceMode({})).toBe("both");
    expect(resolveEvidenceMode(null)).toBe("both");
    expect(resolveEvidenceMode(undefined)).toBe("both");
    expect(resolveEvidenceMode({ evidenceMode: "nope" })).toBe("both");
  });

  it("resolves the removed screen mode to both rather than honouring it", () => {
    expect(resolveEvidenceMode({ evidenceMode: "screen" })).toBe("both");
  });

  it("returns a supported field as-is", () => {
    expect(resolveEvidenceMode({ evidenceMode: "none" })).toBe("none");
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
  it("asks for the screen only in both", () => {
    expect(shouldCaptureScreen("none")).toBe(false);
    expect(shouldCaptureScreen("workflow")).toBe(false);
    expect(shouldCaptureScreen("both")).toBe(true);
  });

  it("asks for capture-kit only in workflow and both", () => {
    expect(shouldCaptureWorkflow("none")).toBe(false);
    expect(shouldCaptureWorkflow("workflow")).toBe(true);
    expect(shouldCaptureWorkflow("both")).toBe(true);
  });

  it("grades the hook stream only in workflow and both", () => {
    expect(shouldEvaluateWorkflow("none")).toBe(false);
    expect(shouldEvaluateWorkflow("workflow")).toBe(true);
    expect(shouldEvaluateWorkflow("both")).toBe(true);
  });
});
