import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/manual-round-test";
});

const mocks = vi.hoisted(() => ({
  challengeFindOne: vi.fn(),
  challengeUpdateMany: vi.fn(),
  buildSessionFind: vi.fn(),
  buildSessionUpdateMany: vi.fn(),
  sandboxKill: vi.fn(),
}));

vi.mock("e2b", () => ({
  Sandbox: { kill: mocks.sandboxKill },
}));

vi.mock("../../src/models/shorts/challenge.js", () => ({
  CHALLENGE_CATEGORIES: ["widget", "game", "tool", "other"],
  CHALLENGE_STATUSES: ["draft", "published"],
  getPlayChallengeModel: () => ({
    findOne: mocks.challengeFindOne,
    updateMany: mocks.challengeUpdateMany,
  }),
}));

vi.mock("../../src/models/shorts/buildSession.js", () => ({
  getPlayBuildSessionModel: () => ({
    find: mocks.buildSessionFind,
    updateMany: mocks.buildSessionUpdateMany,
  }),
}));

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => ({}),
}));

const { activateChallenge, getActiveChallengeDate, getCurrentChallenge } =
  await import("../../src/services/shorts/challenges.js");

describe("manual Shorts rounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSessionFind.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  it("selects the explicit active marker without consulting the date", async () => {
    const active = {
      slug: "one-button-game",
      challengeDate: "2026-08-17",
      title: "One Button",
      prompt: "Build it",
      tokenBudget: 40_000,
      category: "game",
      status: "published",
      isActive: true,
    };
    mocks.challengeFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(active),
    });

    const result = await getCurrentChallenge();

    expect(mocks.challengeFindOne).toHaveBeenCalledWith({
      status: "published",
      isActive: true,
    });
    expect(result?.challengeDate).toBe("2026-08-17");
    expect(result?.isActive).toBe(true);
  });

  it("does not fall back to a calendar key when no round is active", async () => {
    mocks.challengeFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });

    await expect(getActiveChallengeDate()).rejects.toMatchObject({
      statusCode: 404,
      message: "no_active_round",
    });
  });

  it("changes rounds only through explicit activation", async () => {
    const target = {
      slug: "next-round",
      challengeDate: "2026-09-01",
      status: "published",
      isActive: false,
      activatedAt: undefined as Date | undefined,
      deactivatedAt: undefined as Date | undefined,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({
        slug: "next-round",
        challengeDate: "2026-09-01",
        status: "published",
        isActive: true,
      }),
    };
    mocks.challengeFindOne.mockResolvedValue(target);
    mocks.challengeUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mocks.buildSessionUpdateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await activateChallenge("next-round");

    expect(mocks.challengeUpdateMany).toHaveBeenCalledWith(
      { isActive: true, slug: { $ne: "next-round" } },
      {
        $set: {
          isActive: false,
          deactivatedAt: expect.any(Date),
        },
      },
    );
    expect(target.isActive).toBe(true);
    expect(target.activatedAt).toBeInstanceOf(Date);
    expect(target.save).toHaveBeenCalledOnce();
    expect(mocks.buildSessionUpdateMany).toHaveBeenCalledTimes(2);
    expect(result.isActive).toBe(true);
  });
});

