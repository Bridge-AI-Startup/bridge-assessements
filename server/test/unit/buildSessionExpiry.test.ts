import { describe, expect, it, vi } from "vitest";

// sessionPersist.ts reaches the Shorts models, and shortsConnection.ts throws
// at import time without ATLAS_URI. The model is mocked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/build-expiry-test";
});

vi.mock("../../src/models/shorts/buildSession.js", () => ({
  getPlayBuildSessionModel: () => ({}),
}));

const {
  computeBuildSessionExpiresAt,
  endOfUtcChallengeDay,
  isWithinSubmitGrace,
} = await import("../../src/services/shorts/sessionPersist.js");

/**
 * Builds deliberately have **no per-session clock**. A session used to expire a
 * fixed number of minutes after it started, which meant a finished build could
 * be lost while its author typed a name or signed in. The only deadline left is
 * the challenge round, because a submission has to belong to the round it was
 * built for.
 */
describe("computeBuildSessionExpiresAt", () => {
  it("expires at the end of the challenge round, not a fixed window", () => {
    const expiresAt = computeBuildSessionExpiresAt({
      challengeDate: "2026-08-03",
    });
    expect(expiresAt.getTime()).toBe(
      endOfUtcChallengeDay("2026-08-03").getTime(),
    );
  });

  it("gives the same deadline no matter when the build started", () => {
    // Two builders starting hours apart get the identical deadline — the whole
    // point of dropping the per-build timer.
    const first = computeBuildSessionExpiresAt({ challengeDate: "2026-08-03" });
    const second = computeBuildSessionExpiresAt({ challengeDate: "2026-08-03" });
    expect(first.getTime()).toBe(second.getTime());
  });

  it("honours a window-override round end over the cadence-derived one", () => {
    const override = new Date("2026-08-05T12:00:00.000Z");
    const expiresAt = computeBuildSessionExpiresAt({
      challengeDate: "2026-08-03",
      periodEndsAt: override,
    });
    expect(expiresAt.getTime()).toBe(override.getTime());
  });

  it("is far enough out that a normal build never races it", () => {
    // Regression guard: any reintroduced short window would fail here.
    const expiresAt = computeBuildSessionExpiresAt({
      challengeDate: "2026-08-03",
    });
    const startOfRound = new Date("2026-08-03T00:00:00.000Z").getTime();
    const windowMs = expiresAt.getTime() - startOfRound;
    expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});

describe("isWithinSubmitGrace", () => {
  const roundEnd = new Date("2026-08-09T23:59:59.999Z");

  it("is false while the round is still open", () => {
    expect(isWithinSubmitGrace(roundEnd, roundEnd.getTime() - 60_000)).toBe(
      false,
    );
  });

  it("keeps an in-flight submit alive just past the round rollover", () => {
    expect(isWithinSubmitGrace(roundEnd, roundEnd.getTime() + 30_000)).toBe(
      true,
    );
  });

  it("lapses once the grace window is spent", () => {
    expect(
      isWithinSubmitGrace(roundEnd, roundEnd.getTime() + 10 * 60_000),
    ).toBe(false);
  });

  it("is false when the session has no deadline at all", () => {
    expect(isWithinSubmitGrace(null)).toBe(false);
  });
});
