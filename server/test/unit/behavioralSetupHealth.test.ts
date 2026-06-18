import { describe, expect, it } from "vitest";
import { orderChecksForIsolation } from "../../src/services/behavioralGrading/setupHealth.js";

describe("orderChecksForIsolation", () => {
  it("runs read-only checks before mutating checks", () => {
    const checks = [
      "Someone can add a note.",
      "The app shows a welcome message.",
      "Notes still show up after refreshing the page.",
    ];
    const ordered = orderChecksForIsolation(checks);
    expect(ordered.map((o) => o.checkText)).toEqual([
      "The app shows a welcome message.",
      "Someone can add a note.",
      "Notes still show up after refreshing the page.",
    ]);
    expect(ordered.map((o) => o.originalIndex)).toEqual([1, 0, 2]);
  });

  it("preserves relative order within each group", () => {
    const checks = ["Shows title.", "Shows footer.", "Can submit form."];
    const ordered = orderChecksForIsolation(checks);
    expect(ordered.map((o) => o.originalIndex)).toEqual([0, 1, 2]);
  });
});
