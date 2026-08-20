import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Candidate LLM proxy — Bridge-provided AI credits for assessment candidates.
 *
 * Covers the auth/budget gate (hashed bearer token → submission, live budget
 * from the assessment), the metering math, the receipt row, and the pure
 * request/response extraction helpers.
 */

const SubmissionModel = {
  findOne: vi.fn(),
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
};
const AssessmentModel = {
  findById: vi.fn(),
};
const LlmProxyCallModel = {
  create: vi.fn(async () => ({})),
};

vi.mock("../../src/models/submission.js", () => ({ default: SubmissionModel }));
vi.mock("../../src/models/assessment.js", () => ({ default: AssessmentModel }));
vi.mock("../../src/models/llmProxyCall.js", () => ({
  default: LlmProxyCallModel,
  LlmProxyCallModel,
}));

const {
  hashCandidateLlmToken,
  generateCandidateLlmToken,
  parseAnthropicUsage,
  extractLastUserText,
  extractResponseText,
  issueCandidateLlmToken,
  handleCandidateLlmUsage,
  handleCandidateMessagesProxy,
  CANDIDATE_LLM_PROXY_PATH,
} = await import("../../src/services/candidateLlmProxy.js");

/** Chainable .select().lean() stub used by the service's queries. */
function leanResult(value: unknown) {
  return {
    select: vi.fn(() => ({ lean: vi.fn(async () => value) })),
  };
}

function fakeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    write() {
      return true;
    },
    end() {
      res.ended = true;
    },
  };
  return res;
}

function reqWithBearer(token: string | null, body: unknown = {}) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  } as any;
}

beforeEach(() => {
  SubmissionModel.findOne.mockReset();
  SubmissionModel.updateOne.mockReset();
  SubmissionModel.updateOne.mockResolvedValue({ modifiedCount: 1 } as any);
  AssessmentModel.findById.mockReset();
  LlmProxyCallModel.create.mockReset();
  LlmProxyCallModel.create.mockResolvedValue({} as any);
  process.env.ANTHROPIC_API_KEY = "test-org-key";
  delete process.env.CANDIDATE_LLM_PROXY_ENABLED;
});

describe("token hashing", () => {
  it("stores only a hash a DB leak cannot invert", () => {
    const raw = generateCandidateLlmToken();
    const hash = hashCandidateLlmToken(raw);
    expect(hash).not.toEqual(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCandidateLlmToken(raw)).toEqual(hash);
  });

  it("issueCandidateLlmToken persists the hash of the returned token and leaves counters alone", async () => {
    const raw = await issueCandidateLlmToken("sub-1");
    expect(SubmissionModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = SubmissionModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "sub-1" });
    expect(update.$set["llmProxy.tokenHash"]).toEqual(
      hashCandidateLlmToken(raw),
    );
    // Rotation must not refill spent credits.
    expect(update.$inc).toBeUndefined();
    expect(update.$set["llmProxy.tokensUsed"]).toBeUndefined();
  });
});

describe("request/response extraction (receipt fields)", () => {
  it("takes the newest typed user text, skipping tool_result-only turns", () => {
    expect(
      extractLastUserText({
        messages: [
          { role: "user", content: "build me a todo app" },
          { role: "assistant", content: [{ type: "text", text: "ok" }] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1" }],
          },
        ],
      }),
    ).toEqual("build me a todo app");
  });

  it("prefers the typed prompt over Claude Code's injected system reminders", () => {
    expect(
      extractLastUserText({
        messages: [
          { role: "user", content: "add dark mode" },
          {
            role: "user",
            content: [
              { type: "text", text: "<system-reminder>hooks fired</system-reminder>" },
            ],
          },
        ],
      }),
    ).toEqual("add dark mode");
    // Falls back to injected text rather than an empty receipt.
    expect(
      extractLastUserText({
        messages: [
          { role: "user", content: "<system-reminder>only this</system-reminder>" },
        ],
      }),
    ).toEqual("<system-reminder>only this</system-reminder>");
  });

  it("reads text blocks from array content", () => {
    expect(
      extractLastUserText({
        messages: [
          { role: "user", content: [{ type: "text", text: "fix the bug" }] },
        ],
      }),
    ).toEqual("fix the bug");
    expect(extractLastUserText({})).toBeNull();
  });

  it("joins assistant text blocks from a non-streaming response", () => {
    expect(
      extractResponseText({
        content: [
          { type: "text", text: "Here's the fix." },
          { type: "tool_use", name: "Edit" },
          { type: "text", text: "Done." },
        ],
      }),
    ).toEqual("Here's the fix.\nDone.");
    expect(extractResponseText(null)).toBeNull();
  });

  it("parses usage and defaults to zero", () => {
    expect(
      parseAnthropicUsage({ usage: { input_tokens: 900, output_tokens: 120 } }),
    ).toEqual({ input: 900, output: 120 });
    expect(parseAnthropicUsage(null)).toEqual({ input: 0, output: 0 });
  });
});

describe("usage endpoint", () => {
  it("401s without a bearer token", async () => {
    const res = fakeRes();
    await handleCandidateLlmUsage(reqWithBearer(null), res);
    expect(res.statusCode).toBe(401);
  });

  it("403s an unknown token", async () => {
    SubmissionModel.findOne.mockReturnValue(leanResult(null));
    const res = fakeRes();
    await handleCandidateLlmUsage(reqWithBearer("nope"), res);
    expect(res.statusCode).toBe(403);
  });

  it("reports the live budget from the assessment", async () => {
    SubmissionModel.findOne.mockReturnValue(
      leanResult({
        assessmentId: "a1",
        llmProxy: {
          tokensUsed: 1_200,
          inputTokensUsed: 1_000,
          outputTokensUsed: 200,
          calls: 3,
        },
      }),
    );
    AssessmentModel.findById.mockReturnValue(
      leanResult({ candidateLlmCredits: 5_000_000 }),
    );
    const res = fakeRes();
    await handleCandidateLlmUsage(reqWithBearer("tok"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      creditBudget: 5_000_000,
      tokensUsed: 1_200,
      inputTokens: 1_000,
      outputTokens: 200,
      calls: 3,
      remaining: 4_998_800,
      exhausted: false,
    });
  });
});

describe("messages proxy gate", () => {
  function liveSubmission(overrides: Record<string, unknown> = {}) {
    return {
      _id: "sub-1",
      status: "in-progress",
      assessmentId: "a1",
      llmProxy: { tokensUsed: 0 },
      ...overrides,
    };
  }

  it("503s when the kill switch is off", async () => {
    process.env.CANDIDATE_LLM_PROXY_ENABLED = "false";
    const res = fakeRes();
    await handleCandidateMessagesProxy(reqWithBearer("tok"), res);
    expect(res.statusCode).toBe(503);
    expect((res.body as any).error).toBe("candidate_llm_proxy_disabled");
  });

  it("403s a closed attempt", async () => {
    SubmissionModel.findOne.mockReturnValue(
      leanResult(liveSubmission({ status: "submitted" })),
    );
    const res = fakeRes();
    await handleCandidateMessagesProxy(reqWithBearer("tok"), res);
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toBe("attempt_closed");
  });

  it("403s when the employer turned credits off after issuing", async () => {
    SubmissionModel.findOne.mockReturnValue(leanResult(liveSubmission()));
    AssessmentModel.findById.mockReturnValue(
      leanResult({ candidateLlmCredits: 0 }),
    );
    const res = fakeRes();
    await handleCandidateMessagesProxy(reqWithBearer("tok"), res);
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toBe("credits_disabled");
  });

  it("429s an exhausted budget", async () => {
    SubmissionModel.findOne.mockReturnValue(
      leanResult(liveSubmission({ llmProxy: { tokensUsed: 5_000_000 } })),
    );
    AssessmentModel.findById.mockReturnValue(
      leanResult({ candidateLlmCredits: 5_000_000 }),
    );
    const res = fakeRes();
    await handleCandidateMessagesProxy(reqWithBearer("tok"), res);
    expect(res.statusCode).toBe(429);
    expect((res.body as any).error).toBe("credit_budget_exceeded");
  });

  it("forwards a non-streaming call, meters it, and writes a receipt", async () => {
    SubmissionModel.findOne.mockReturnValue(leanResult(liveSubmission()));
    AssessmentModel.findById.mockReturnValue(
      leanResult({ candidateLlmCredits: 5_000_000 }),
    );

    const upstreamBody = JSON.stringify({
      content: [{ type: "text", text: "hello from claude" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 800, output_tokens: 50 },
    });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      headers: new Map([["content-type", "application/json"]]) as any,
      text: async () => upstreamBody,
    }));
    (fetchMock.mock as any); // keep TS quiet about shape
    vi.stubGlobal("fetch", fetchMock as any);
    // Map lacks fetch's Headers.get semantics parity — patch get.
    fetchMock.mockImplementation(async () => ({
      status: 200,
      headers: { get: (k: string) => (k === "content-type" ? "application/json" : null) },
      text: async () => upstreamBody,
    }) as any);

    const res = fakeRes();
    await handleCandidateMessagesProxy(
      reqWithBearer("tok", {
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
      }),
      res,
    );

    // Forwarded with the org key, not the candidate token.
    const [url, init] = (fetchMock.mock.calls as any)[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("test-org-key");

    // Metered input + output against the submission.
    const meterCall = SubmissionModel.updateOne.mock.calls.find(
      ([, update]: any[]) => update?.$inc?.["llmProxy.tokensUsed"] != null,
    ) as any[];
    expect(meterCall[1].$inc["llmProxy.tokensUsed"]).toBe(850);
    expect(meterCall[1].$inc["llmProxy.inputTokensUsed"]).toBe(800);
    expect(meterCall[1].$inc["llmProxy.outputTokensUsed"]).toBe(50);

    // Receipt row written.
    expect(LlmProxyCallModel.create).toHaveBeenCalledTimes(1);
    const receipt = (LlmProxyCallModel.create.mock.calls as any)[0][0];
    expect(receipt.model).toBe("claude-sonnet-5");
    expect(receipt.status).toBe(200);
    expect(receipt.usage).toEqual({ input: 800, output: 50 });
    expect(receipt.lastUserText).toBe("hi");
    expect(receipt.responseText).toBe("hello from claude");
    expect(receipt.stopReason).toBe("end_turn");
    expect(receipt.requestSha256).toMatch(/^[0-9a-f]{64}$/);

    // Response relayed unchanged.
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(upstreamBody);

    vi.unstubAllGlobals();
  });
});

describe("constants", () => {
  it("exposes the base path the capture kit composes ANTHROPIC_BASE_URL from", () => {
    expect(CANDIDATE_LLM_PROXY_PATH).toBe("/api/workflow-capture/llm");
  });
});
