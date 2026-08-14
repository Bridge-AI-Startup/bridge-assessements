import { describe, expect, it } from "vitest";

import {
  FINAL_SUBMISSION_GRACE_MINUTES,
  getSubmissionTimingWindow,
} from "../../src/utils/submissionTiming.js";

describe("getSubmissionTimingWindow", () => {
  it("returns empty timing when the attempt has no clock", () => {
    expect(getSubmissionTimingWindow({}, { timeLimit: 30 })).toEqual({
      elapsedMinutes: null,
      isLate: false,
      isBeyondGrace: false,
    });
    expect(
      getSubmissionTimingWindow({ startedAt: new Date() }, { timeLimit: null })
    ).toEqual({
      elapsedMinutes: null,
      isLate: false,
      isBeyondGrace: false,
    });
  });

  it("is on time while inside the limit", () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const t = getSubmissionTimingWindow({ startedAt }, { timeLimit: 30 });
    expect(t.elapsedMinutes).toBeGreaterThan(4);
    expect(t.elapsedMinutes).toBeLessThan(6);
    expect(t.isLate).toBe(false);
    expect(t.isBeyondGrace).toBe(false);
  });

  it("is late but still in grace for the five minutes after timeLimit", () => {
    const startedAt = new Date(Date.now() - 12 * 60 * 1000);
    const t = getSubmissionTimingWindow({ startedAt }, { timeLimit: 10 });
    expect(t.isLate).toBe(true);
    expect(t.isBeyondGrace).toBe(false);
  });

  it("is beyond grace after timeLimit + 5 minutes", () => {
    const startedAt = new Date(
      Date.now() - (10 + FINAL_SUBMISSION_GRACE_MINUTES + 1) * 60 * 1000
    );
    const t = getSubmissionTimingWindow({ startedAt }, { timeLimit: 10 });
    expect(t.isLate).toBe(true);
    expect(t.isBeyondGrace).toBe(true);
  });
});
