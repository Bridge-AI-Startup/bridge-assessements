import { afterEach, describe, expect, it, vi } from "vitest";

import { signIn, signUp } from "../../e2e/lib/firebaseAuth.js";

afterEach(() => vi.restoreAllMocks());

describe("E2E firebaseAuth", () => {
  it("shapes a successful signUp response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          idToken: "tok",
          refreshToken: "ref",
          localId: "uid123",
        }),
      })) as any
    );
    const out = await signUp("e2e@bridge-e2e.test", "pw");
    expect(out).toEqual({
      idToken: "tok",
      refreshToken: "ref",
      localId: "uid123",
      email: "e2e@bridge-e2e.test",
    });
  });

  it("throws a descriptive error on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: { message: "EMAIL_EXISTS" } }),
      })) as any
    );
    await expect(signIn("e2e@bridge-e2e.test", "pw")).rejects.toThrow(/EMAIL_EXISTS/);
  });
});
