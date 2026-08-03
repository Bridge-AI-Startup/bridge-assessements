import { describe, expect, it } from "vitest";

import { isDevLoopbackOrigin } from "../../src/utils/corsOrigins.js";

/**
 * Regression: a Shorts client on any port other than the three hardcoded dev
 * origins was rejected by CORS. The rejection returns a 500 with no
 * `Access-Control-Allow-Origin` header, so the browser blocks the response and
 * the page sees only `TypeError: Failed to fetch` — the reported symptom when
 * saving a challenge in the Shorts admin.
 */
describe("isDevLoopbackOrigin", () => {
  const DEV = "development";

  it("accepts a Vite port assigned because the default was taken", () => {
    // The exact origin that reproduced the bug.
    expect(isDevLoopbackOrigin("http://localhost:54534", DEV)).toBe(true);
  });

  it("accepts the standard client, shorts, and backend dev ports", () => {
    for (const origin of [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "http://localhost:5050",
    ]) {
      expect(isDevLoopbackOrigin(origin, DEV)).toBe(true);
    }
  });

  it("accepts 127.0.0.1 and [::1], not just the localhost hostname", () => {
    expect(isDevLoopbackOrigin("http://127.0.0.1:5174", DEV)).toBe(true);
    expect(isDevLoopbackOrigin("http://[::1]:5174", DEV)).toBe(true);
  });

  it("accepts https loopback (a locally trusted cert)", () => {
    expect(isDevLoopbackOrigin("https://localhost:8443", DEV)).toBe(true);
  });

  it("rejects every loopback origin outside development", () => {
    for (const env of ["production", "test", "staging"]) {
      expect(isDevLoopbackOrigin("http://localhost:54534", env)).toBe(false);
      expect(isDevLoopbackOrigin("http://127.0.0.1:5174", env)).toBe(false);
    }
  });

  it("rejects loopback when NODE_ENV is unset, so a misconfigured deploy does not widen CORS", () => {
    expect(isDevLoopbackOrigin("http://localhost:54534", undefined)).toBe(false);
    expect(isDevLoopbackOrigin("http://localhost:5174", "")).toBe(false);
  });

  it("rejects non-loopback origins even in development", () => {
    for (const origin of [
      "https://evil.example.com",
      "http://localhost.evil.com:5174",
      "http://127.0.0.1.evil.com:5174",
      "http://192.168.1.50:5174",
      "http://notlocalhost:5174",
    ]) {
      expect(isDevLoopbackOrigin(origin, DEV)).toBe(false);
    }
  });

  it("requires an explicit port, so a bare loopback host does not match", () => {
    expect(isDevLoopbackOrigin("http://localhost", DEV)).toBe(false);
  });

  it("rejects a loopback authority carrying a path or credentials", () => {
    expect(isDevLoopbackOrigin("http://localhost:5174/api", DEV)).toBe(false);
    expect(isDevLoopbackOrigin("http://user@localhost:5174", DEV)).toBe(false);
  });
});
