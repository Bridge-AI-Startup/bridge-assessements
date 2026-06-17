import { describe, expect, it } from "vitest";

import { withRetry } from "../../src/ai/transcript/visionClient.js";

describe("visionClient.withRetry — adaptive rate-limit safeguards", () => {
  it("returns the result on success", async () => {
    const out = await withRetry(async () => 42, "ok");
    expect(out).toBe(42);
  });

  it("retries on 429 and honours a Retry-After header", async () => {
    let attempts = 0;
    const start = Date.now();
    const out = await withRetry(async () => {
      attempts++;
      if (attempts === 1) {
        const err: any = new Error("rate limited");
        err.status = 429;
        err.headers = { "retry-after": "0" };
        throw err;
      }
      return "recovered";
    }, "retry-429");
    expect(out).toBe("recovered");
    expect(attempts).toBe(2);
    // Retry-After "0" -> base delay 0 (plus small jitter), so it must be quick.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("gives up after maxRetries and rethrows", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          const err: any = new Error("always 429");
          err.status = 429;
          err.headers = { "retry-after": "0" };
          throw err;
        },
        "exhaust",
        2
      )
    ).rejects.toThrow(/always 429/);
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("never exceeds the concurrency cap (OPENAI_MAX_CONCURRENT=2)", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const task = () =>
      withRetry(async () => {
        inFlight++;
        maxObserved = Math.max(maxObserved, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight--;
        return true;
      }, "concurrency");

    await Promise.all(Array.from({ length: 8 }, () => task()));
    expect(maxObserved).toBeGreaterThan(0);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });
});
