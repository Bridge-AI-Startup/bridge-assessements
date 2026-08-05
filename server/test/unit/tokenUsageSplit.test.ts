import { beforeEach, describe, expect, it, vi } from "vitest";

// llmProxy.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. The model is mocked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/token-split-test";
});

const BuildSessionModel = {
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
};

vi.mock("../../src/models/shorts/buildSession.js", () => ({
  getPlayBuildSessionModel: () => BuildSessionModel,
}));

const { incrementSessionUsage, parseUsageFromAnthropicBody } = await import(
  "../../src/services/shorts/llmProxy.js"
);

describe("parseUsageFromAnthropicBody", () => {
  it("keeps input and output apart", () => {
    expect(
      parseUsageFromAnthropicBody({
        usage: { input_tokens: 1200, output_tokens: 340 },
      }),
    ).toEqual({ input: 1200, output: 340 });
  });

  it("is zero for bodies with no usage block", () => {
    expect(parseUsageFromAnthropicBody(null)).toEqual({ input: 0, output: 0 });
    expect(parseUsageFromAnthropicBody({})).toEqual({ input: 0, output: 0 });
    expect(parseUsageFromAnthropicBody({ usage: {} })).toEqual({
      input: 0,
      output: 0,
    });
  });
});

describe("incrementSessionUsage", () => {
  beforeEach(() => {
    BuildSessionModel.updateOne.mockClear();
  });

  it("increments the budget by the sum and each direction on its own", async () => {
    await incrementSessionUsage("sess-1", { input: 1200, output: 340 });

    expect(BuildSessionModel.updateOne).toHaveBeenCalledWith(
      { _id: "sess-1" },
      {
        $inc: {
          tokensUsed: 1540,
          inputTokensUsed: 1200,
          outputTokensUsed: 340,
          llmCalls: 1,
        },
      },
    );
  });

  it("does not write (or count a call) when nothing was spent", async () => {
    await incrementSessionUsage("sess-1", { input: 0, output: 0 });
    expect(BuildSessionModel.updateOne).not.toHaveBeenCalled();
  });

  it("floors negative counts rather than crediting the budget back", async () => {
    await incrementSessionUsage("sess-1", { input: -50, output: 200 });
    expect(BuildSessionModel.updateOne).toHaveBeenCalledWith(
      { _id: "sess-1" },
      {
        $inc: {
          tokensUsed: 200,
          inputTokensUsed: 0,
          outputTokensUsed: 200,
          llmCalls: 1,
        },
      },
    );
  });
});
