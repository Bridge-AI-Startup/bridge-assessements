import { beforeEach, describe, expect, it, vi } from "vitest";

// stars.ts reaches the Shorts models via its imports; shortsConnection.ts
// throws at import time without ATLAS_URI. Models themselves are mocked.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/shorts-stars-test";
});

const SUB_ID = "64b7f9c2e1a2b3c4d5e6f701";
const OTHER_SUB_ID = "64b7f9c2e1a2b3c4d5e6f702";

function findByIdResult(doc: unknown) {
  const promise = Promise.resolve(doc);
  return Object.assign(promise, {
    select: vi.fn(() => ({ lean: vi.fn(async () => doc) })),
  });
}

const SubmissionModel = {
  findById: vi.fn(() =>
    findByIdResult({ challengeDate: "2026-08-17" }),
  ),
};

function findStarsResult(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    lean: vi.fn(async () => rows),
  };
  return chain;
}

const StarModel = {
  updateOne: vi.fn(async () => ({ upsertedCount: 1 })),
  deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
  find: vi.fn(() => findStarsResult([])),
};

const { getLinkedAnonymousIds } = vi.hoisted(() => ({
  getLinkedAnonymousIds: vi.fn(async () => [] as string[]),
}));

const { listSubmissionSummariesByIds } = vi.hoisted(() => ({
  listSubmissionSummariesByIds: vi.fn(async () => [] as Array<{ id: string }>),
}));

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => SubmissionModel,
}));
vi.mock("../../src/models/shorts/star.js", () => ({
  getPlayStarModel: () => StarModel,
}));
vi.mock("../../src/services/shorts/account.js", () => ({
  getLinkedAnonymousIds,
}));
vi.mock("../../src/services/shorts/voting.js", () => ({
  listSubmissionSummariesByIds,
}));

const { setStarred, listStarred } = await import(
  "../../src/services/shorts/stars.js"
);

const ANON = "anon-browser-aaaaaaaa";

beforeEach(() => {
  StarModel.updateOne.mockClear();
  StarModel.deleteMany.mockClear();
  StarModel.find.mockClear();
  StarModel.find.mockImplementation(() => findStarsResult([]));
  SubmissionModel.findById.mockClear();
  SubmissionModel.findById.mockImplementation(() =>
    findByIdResult({ challengeDate: "2026-08-17" }),
  );
  getLinkedAnonymousIds.mockClear();
  getLinkedAnonymousIds.mockResolvedValue([]);
  listSubmissionSummariesByIds.mockClear();
  listSubmissionSummariesByIds.mockResolvedValue([]);
});

describe("setStarred", () => {
  it("upserts on star with the submission's challengeDate", async () => {
    const result = await setStarred({
      submissionId: SUB_ID,
      anonymousId: ANON,
      starred: true,
    });
    expect(result).toEqual({ starred: true });
    expect(StarModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = StarModel.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $setOnInsert: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(filter.anonymousId).toBe(ANON);
    expect(update.$setOnInsert.challengeDate).toBe("2026-08-17");
    expect(opts.upsert).toBe(true);
  });

  it("404s when starring a submission that no longer exists", async () => {
    SubmissionModel.findById.mockImplementation(() => findByIdResult(null));
    await expect(
      setStarred({ submissionId: SUB_ID, anonymousId: ANON, starred: true }),
    ).rejects.toMatchObject({ status: 404 });
    expect(StarModel.updateOne).not.toHaveBeenCalled();
  });

  it("unstars across linked ids and the account stamp when signed in", async () => {
    getLinkedAnonymousIds.mockResolvedValue(["anon-other-device-bbbb"]);
    const result = await setStarred({
      submissionId: SUB_ID,
      anonymousId: ANON,
      firebaseUid: "uid-1",
      starred: false,
    });
    expect(result).toEqual({ starred: false });
    const [filter] = StarModel.deleteMany.mock.calls[0] as [
      { $or: Array<Record<string, unknown>> },
    ];
    expect(filter.$or).toEqual([
      { anonymousId: ANON },
      { firebaseUid: "uid-1" },
      { anonymousId: { $in: ["anon-other-device-bbbb"] } },
    ]);
  });

  it("rejects a missing anonymousId", async () => {
    await expect(
      setStarred({ submissionId: SUB_ID, anonymousId: "", starred: true }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("listStarred", () => {
  it("dedupes the same build starred on two linked devices, newest first", async () => {
    StarModel.find.mockImplementation(() =>
      findStarsResult([
        { submissionId: SUB_ID },
        { submissionId: OTHER_SUB_ID },
        { submissionId: SUB_ID },
      ]),
    );
    listSubmissionSummariesByIds.mockResolvedValue([
      { id: SUB_ID },
      { id: OTHER_SUB_ID },
    ]);
    const result = await listStarred({ anonymousId: ANON });
    expect(result.ids).toEqual([SUB_ID, OTHER_SUB_ID]);
    expect(listSubmissionSummariesByIds).toHaveBeenCalledWith(
      [SUB_ID, OTHER_SUB_ID],
      { anonymousId: ANON, firebaseUid: undefined },
    );
  });

  it("drops ids whose submission is gone", async () => {
    StarModel.find.mockImplementation(() =>
      findStarsResult([
        { submissionId: SUB_ID },
        { submissionId: OTHER_SUB_ID },
      ]),
    );
    listSubmissionSummariesByIds.mockResolvedValue([{ id: OTHER_SUB_ID }]);
    const result = await listStarred({ anonymousId: ANON });
    expect(result.ids).toEqual([OTHER_SUB_ID]);
  });

  it("idsOnly skips the summary load", async () => {
    StarModel.find.mockImplementation(() =>
      findStarsResult([{ submissionId: SUB_ID }]),
    );
    const result = await listStarred({ anonymousId: ANON, idsOnly: true });
    expect(result.ids).toEqual([SUB_ID]);
    expect(result.submissions).toBeUndefined();
    expect(listSubmissionSummariesByIds).not.toHaveBeenCalled();
  });
});
