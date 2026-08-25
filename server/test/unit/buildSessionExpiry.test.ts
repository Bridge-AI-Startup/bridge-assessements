import { describe, expect, it, vi } from "vitest";

// sessionPersist.ts reaches the Shorts models, and shortsConnection.ts throws
// at import time without ATLAS_URI. The model is mocked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/build-expiry-test";
});

vi.mock("../../src/models/shorts/buildSession.js", () => ({
  getPlayBuildSessionModel: () => ({}),
}));

const { isWithinSubmitGrace } = await import(
  "../../src/services/shorts/sessionPersist.js"
);

describe("isWithinSubmitGrace", () => {
  const legacyExpiry = new Date("2026-08-09T23:59:59.999Z");

  it("is false before a legacy expiry", () => {
    expect(
      isWithinSubmitGrace(legacyExpiry, legacyExpiry.getTime() - 60_000),
    ).toBe(
      false,
    );
  });

  it("keeps an in-flight submit alive just past a legacy expiry", () => {
    expect(
      isWithinSubmitGrace(legacyExpiry, legacyExpiry.getTime() + 30_000),
    ).toBe(true);
  });

  it("lapses once the grace window is spent", () => {
    expect(
      isWithinSubmitGrace(legacyExpiry, legacyExpiry.getTime() + 10 * 60_000),
    ).toBe(false);
  });

  it("is false when the session has no deadline at all", () => {
    expect(isWithinSubmitGrace(null)).toBe(false);
  });
});
