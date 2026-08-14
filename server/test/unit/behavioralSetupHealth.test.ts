import { describe, expect, it } from "vitest";
import {
  gradingFaultOwner,
  inferFailureCategory,
  orderChecksForIsolation,
} from "../../src/services/behavioralGrading/setupHealth.js";

describe("orderChecksForIsolation", () => {
  it("runs read-only checks before mutating checks", () => {
    const checks = [
      "Someone can add a note.",
      "The app shows a welcome message.",
      "Notes still show up after refreshing the page.",
    ];
    const ordered = orderChecksForIsolation(checks);
    // Adding a note is the only check here that changes state, so it runs last.
    expect(ordered.map((o) => o.checkText)).toEqual([
      "The app shows a welcome message.",
      "Notes still show up after refreshing the page.",
      "Someone can add a note.",
    ]);
    expect(ordered.map((o) => o.originalIndex)).toEqual([1, 2, 0]);
  });

  it("preserves relative order within each group", () => {
    const checks = ["Shows title.", "Shows footer.", "Can submit form."];
    const ordered = orderChecksForIsolation(checks);
    expect(ordered.map((o) => o.originalIndex)).toEqual([0, 1, 2]);
  });
});

describe("inferFailureCategory", () => {
  it("marks grading that is switched off as disabled", () => {
    expect(inferFailureCategory("Behavioral grading is disabled")).toBe("disabled");
    expect(
      inferFailureCategory("Behavioral grading (E2B) is disabled. Set BEHAVIORAL_GRADING_ENABLED=true to enable.")
    ).toBe("disabled");
  });

  it("attributes a server restart to interrupted, not setup", () => {
    expect(
      inferFailureCategory(
        "Behavioral grading was interrupted by a server restart before it finished."
      )
    ).toBe("interrupted");
    expect(inferFailureCategory("The process was restarted mid-grade")).toBe(
      "interrupted"
    );
  });

  it("attributes E2B, clone, archive, storage, and extract failures to the platform", () => {
    expect(inferFailureCategory("E2B sandbox create failed")).toBe("environment");
    expect(inferFailureCategory("Failed to clone repository")).toBe("environment");
    expect(inferFailureCategory("Failed to extract uploaded archive")).toBe(
      "environment"
    );
    expect(inferFailureCategory("grading evidence storage is unavailable")).toBe(
      "environment"
    );
    expect(inferFailureCategory("missing e2b api key")).toBe("environment");
    // "not set" is checked before platform markers — a missing env var is
    // disabled, not a sandbox outage.
    expect(inferFailureCategory("E2B_API_KEY is not set")).toBe("disabled");
  });

  it("lets platform markers win even when the message also mentions the runbook", () => {
    expect(
      inferFailureCategory(
        "Failed to extract uploaded archive while planning the runbook from the README"
      )
    ).toBe("environment");
    expect(
      inferFailureCategory("sandbox died during runbook install")
    ).toBe("environment");
  });

  it("classifies timeouts unless a platform marker already won", () => {
    expect(inferFailureCategory("install step timed out")).toBe("timeout");
    expect(inferFailureCategory("Command timeout after 10 minutes")).toBe("timeout");
    expect(inferFailureCategory("e2b sandbox timed out")).toBe("environment");
  });

  it("keeps a missing README, runbook, or empty check list as candidate setup", () => {
    expect(inferFailureCategory("Assessment has no behavioral checks configured.")).toBe(
      "setup"
    );
    expect(inferFailureCategory("Could not plan a runbook from the README")).toBe(
      "setup"
    );
    expect(inferFailureCategory("README has no install command")).toBe("setup");
  });

  it("returns unknown for unrelated errors", () => {
    expect(inferFailureCategory("something went sideways")).toBe("unknown");
    expect(inferFailureCategory("")).toBe("unknown");
  });
});

describe("gradingFaultOwner", () => {
  it("never treats platform outages as candidate faults", () => {
    expect(gradingFaultOwner("environment")).toBe("platform");
    expect(gradingFaultOwner("interrupted")).toBe("platform");
    expect(gradingFaultOwner("disabled")).toBe("platform");
    expect(gradingFaultOwner("setup")).toBe("candidate");
    expect(gradingFaultOwner("timeout")).toBe("unknown");
    expect(gradingFaultOwner("judge")).toBe("unknown");
    expect(gradingFaultOwner("unknown")).toBe("unknown");
    expect(gradingFaultOwner(null)).toBe("unknown");
    expect(gradingFaultOwner(undefined)).toBe("unknown");
  });
});
