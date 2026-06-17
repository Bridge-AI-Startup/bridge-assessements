import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient, expectOk } from "../../e2e/lib/apiClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("E2E ApiClient", () => {
  it("sends Bearer auth + JSON and parses the response body", async () => {
    const fetchMock = vi.fn(async (_url: string, opts: any) => {
      expect(opts.headers.Authorization).toBe("Bearer abc");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(opts.body)).toEqual({ a: 1 });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, n: 7 }),
      } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://test", "abc");
    const res = await client.post("/x", { a: 1 });
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ ok: true, n: 7 });
    expect(fetchMock).toHaveBeenCalledWith("http://test/x", expect.anything());
  });

  it("aborts and throws a budget error when a request hangs", async () => {
    const fetchMock = vi.fn(
      (_url: string, opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const e: any = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://test", null);
    await expect(client.get("/slow", 20)).rejects.toThrow(/budget/i);
  });

  it("expectOk throws a descriptive error on non-2xx", () => {
    expect(() =>
      expectOk({ ok: false, status: 422, body: null, rawText: "bad input" }, "label")
    ).toThrow(/label -> 422: bad input/);
  });
});
