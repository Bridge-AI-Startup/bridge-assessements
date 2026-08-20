import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/shorts-turns-test";
});

import { isTurnStale, TURN_STALE_MS } from "../../src/services/shorts/turns.js";

describe("durable turn lock", () => {
  it("treats a running turn older than the stale window as stuck", () => {
    expect(TURN_STALE_MS).toBe(11 * 60 * 1000);
    const now = Date.parse("2026-08-20T16:00:00.000Z");
    expect(isTurnStale(new Date(now - TURN_STALE_MS - 1), now)).toBe(true);
    expect(isTurnStale(new Date(now - TURN_STALE_MS + 1_000), now)).toBe(false);
    expect(isTurnStale(undefined, now)).toBe(false);
  });
});
