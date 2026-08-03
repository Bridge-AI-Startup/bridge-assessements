import { describe, expect, it, vi } from "vitest";

// sessionPersist.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. Nothing here opens a connection.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/submit-hold-test";
});

import {
  getSubmitHoldMs,
  isWithinSubmitGrace,
  isWithinSubmitHold,
} from "../../src/services/shorts/sessionPersist.js";

const NOW = Date.UTC(2026, 7, 3, 21, 30, 0);
const minutes = (n: number) => n * 60_000;

describe("isWithinSubmitHold", () => {
  it("is false when the dialog was never opened", () => {
    expect(isWithinSubmitHold(null, NOW)).toBe(false);
    expect(isWithinSubmitHold(undefined, NOW)).toBe(false);
  });

  it("holds for the full window after the dialog opened", () => {
    const held = new Date(NOW - minutes(14));
    expect(isWithinSubmitHold(held, NOW)).toBe(true);
  });

  it("lapses once the window is spent", () => {
    const held = new Date(NOW - getSubmitHoldMs() - 1);
    expect(isWithinSubmitHold(held, NOW)).toBe(false);
  });

  it("is true before expiry too — it is a floor under the deadline, not a window after it", () => {
    // Unlike the grace window, which only opens once the clock has run out.
    expect(isWithinSubmitHold(new Date(NOW), NOW)).toBe(true);
    expect(isWithinSubmitGrace(new Date(NOW + minutes(5)), NOW)).toBe(false);
  });

  it("keeps a build submittable well past the grace window", () => {
    // The case that used to lose a finished build: signing in took longer than
    // the two-minute grace.
    const expiresAt = new Date(NOW - minutes(6));
    const heldJustBeforeExpiry = new Date(NOW - minutes(7));

    expect(isWithinSubmitGrace(expiresAt, NOW)).toBe(false);
    expect(isWithinSubmitHold(heldJustBeforeExpiry, NOW)).toBe(true);
  });
});
