import { beforeEach, describe, expect, it, vi } from "vitest";

// submissions.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. The models themselves are mocked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/delete-submission-test";
});

const ID = "64b7f9c2e1a2b3c4d5e6f701";
const OTHER_ID = "64b7f9c2e1a2b3c4d5e6f702";

const submissionDoc = {
  _id: ID,
  anonymousId: "anon-owner-aaaaaaaa",
  firebaseUid: "uid-owner",
  displayName: "Tide clock",
  challengeDate: "2026-08-03",
  deleteOne: vi.fn(async () => undefined),
};

function findByIdResult(doc: unknown) {
  const promise = Promise.resolve(doc);
  return Object.assign(promise, {
    select: vi.fn(async () => doc),
  });
}

const SubmissionModel = {
  findById: vi.fn(() => findByIdResult(submissionDoc)),
  countDocuments: vi.fn(async () => 0),
};
const VoteModel = {
  deleteMany: vi.fn(async () => ({ deletedCount: 3 })),
};
const VoteRoundModel = {
  updateMany: vi.fn(async () => ({ modifiedCount: 2 })),
};

const { getLinkedAnonymousIds } = vi.hoisted(() => ({
  getLinkedAnonymousIds: vi.fn(async () => [] as string[]),
}));

const { isUnlimitedSubmitter } = vi.hoisted(() => ({
  isUnlimitedSubmitter: vi.fn(async () => false),
}));

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => SubmissionModel,
}));
vi.mock("../../src/models/shorts/vote.js", () => ({
  getPlayVoteModel: () => VoteModel,
  getPlayVoteRoundModel: () => VoteRoundModel,
}));
vi.mock("../../src/services/shorts/account.js", () => ({
  linkAnonymousId: vi.fn(async () => ({ linked: true, linkedIds: 1 })),
  getLinkedAnonymousIds,
}));
vi.mock("../../src/services/shorts/unlimitedSubmit.js", () => ({
  isUnlimitedSubmitter,
  SUBMISSION_LIMIT_MESSAGE: "You ran out of builds for the week.",
}));

const {
  deleteSubmission,
  deleteOwnSubmission,
  countOwnerSubmissionsForDate,
  assertUnderSubmissionLimit,
  MAX_SUBMISSIONS_PER_ROUND,
  SUBMISSION_LIMIT_CODE,
} = await import("../../src/services/shorts/submissions.js");

describe("deleteSubmission", () => {
  beforeEach(() => {
    SubmissionModel.findById.mockClear();
    SubmissionModel.findById.mockImplementation(() =>
      findByIdResult(submissionDoc),
    );
    VoteModel.deleteMany.mockClear();
    VoteRoundModel.updateMany.mockClear();
    submissionDoc.deleteOne.mockClear();
  });

  it("rejects an id that is not a Mongo id before touching the database", async () => {
    await expect(deleteSubmission("not-an-id")).rejects.toMatchObject({
      status: 400,
    });
    expect(SubmissionModel.findById).not.toHaveBeenCalled();
  });

  it("404s when the submission is already gone", async () => {
    SubmissionModel.findById.mockImplementation(() => findByIdResult(null));
    await expect(deleteSubmission(ID)).rejects.toMatchObject({ status: 404 });
    expect(VoteModel.deleteMany).not.toHaveBeenCalled();
  });

  it("removes the build, its votes on either side, and reports the count", async () => {
    const result = await deleteSubmission(ID);

    expect(submissionDoc.deleteOne).toHaveBeenCalledTimes(1);
    expect(VoteModel.deleteMany).toHaveBeenCalledWith({
      $or: [{ winnerId: submissionDoc._id }, { loserId: submissionDoc._id }],
    });
    expect(result).toEqual({
      id: ID,
      displayName: "Tide clock",
      challengeDate: "2026-08-03",
      votesRemoved: 3,
    });
  });

  it("scrubs the id out of round recaps for that challenge date", async () => {
    await deleteSubmission(ID);

    expect(VoteRoundModel.updateMany).toHaveBeenCalledWith(
      { challengeDate: "2026-08-03" },
      {
        $pull: { seenSubmissionIds: ID },
        $unset: { [`rankSnapshot.${ID}`]: "" },
      },
    );
  });
});

describe("deleteOwnSubmission", () => {
  beforeEach(() => {
    SubmissionModel.findById.mockClear();
    SubmissionModel.findById.mockImplementation(() =>
      findByIdResult(submissionDoc),
    );
    VoteModel.deleteMany.mockClear();
    VoteRoundModel.updateMany.mockClear();
    submissionDoc.deleteOne.mockClear();
    getLinkedAnonymousIds.mockClear();
    getLinkedAnonymousIds.mockResolvedValue([]);
  });

  it("401s when neither a browser id nor an account is presented", async () => {
    await expect(deleteOwnSubmission(ID, {})).rejects.toMatchObject({
      status: 401,
    });
    expect(SubmissionModel.findById).not.toHaveBeenCalled();
  });

  it("403s when the browser id does not own the build", async () => {
    await expect(
      deleteOwnSubmission(ID, { anonymousId: "anon-stranger-bbbbbbbb" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(submissionDoc.deleteOne).not.toHaveBeenCalled();
  });

  it("lets a guest delete a build from the same browser", async () => {
    const result = await deleteOwnSubmission(ID, {
      anonymousId: "anon-owner-aaaaaaaa",
    });
    expect(result.id).toBe(ID);
    expect(submissionDoc.deleteOne).toHaveBeenCalledTimes(1);
  });

  it("lets a signed-in account delete a build stamped with its uid", async () => {
    await deleteOwnSubmission(ID, { firebaseUid: "uid-owner" });
    expect(submissionDoc.deleteOne).toHaveBeenCalledTimes(1);
  });

  it("lets a signed-in account delete a guest build from a linked browser", async () => {
    getLinkedAnonymousIds.mockResolvedValue(["anon-owner-aaaaaaaa"]);
    const guestDoc = {
      ...submissionDoc,
      firebaseUid: undefined,
      deleteOne: submissionDoc.deleteOne,
    };
    SubmissionModel.findById.mockImplementation(() => findByIdResult(guestDoc));
    await deleteOwnSubmission(OTHER_ID, { firebaseUid: "uid-owner" });
    expect(submissionDoc.deleteOne).toHaveBeenCalledTimes(1);
  });
});

describe("submission limit", () => {
  beforeEach(() => {
    SubmissionModel.countDocuments.mockClear();
    getLinkedAnonymousIds.mockClear();
    getLinkedAnonymousIds.mockResolvedValue([]);
    isUnlimitedSubmitter.mockReset();
    isUnlimitedSubmitter.mockResolvedValue(false);
  });

  it("counts this browser's builds for a guest", async () => {
    SubmissionModel.countDocuments.mockResolvedValue(2);
    const count = await countOwnerSubmissionsForDate({
      anonymousId: "anon-owner-aaaaaaaa",
      challengeDate: "2026-08-03",
    });
    expect(count).toBe(2);
    expect(SubmissionModel.countDocuments).toHaveBeenCalledWith({
      challengeDate: "2026-08-03",
      anonymousId: "anon-owner-aaaaaaaa",
    });
  });

  it("unions linked browsers and the account uid when signed in", async () => {
    getLinkedAnonymousIds.mockResolvedValue([
      "anon-owner-aaaaaaaa",
      "anon-other-cccccccc",
    ]);
    SubmissionModel.countDocuments.mockResolvedValue(3);
    await countOwnerSubmissionsForDate({
      anonymousId: "anon-owner-aaaaaaaa",
      firebaseUid: "uid-owner",
      challengeDate: "2026-08-03",
    });
    expect(SubmissionModel.countDocuments).toHaveBeenCalledWith({
      challengeDate: "2026-08-03",
      $or: [
        {
          anonymousId: {
            $in: ["anon-other-cccccccc", "anon-owner-aaaaaaaa"],
          },
        },
        { firebaseUid: "uid-owner" },
      ],
    });
  });

  it(`refuses a fourth build (max ${MAX_SUBMISSIONS_PER_ROUND})`, async () => {
    SubmissionModel.countDocuments.mockResolvedValue(
      MAX_SUBMISSIONS_PER_ROUND,
    );
    await expect(
      assertUnderSubmissionLimit({
        anonymousId: "anon-owner-aaaaaaaa",
        challengeDate: "2026-08-03",
      }),
    ).rejects.toMatchObject({
      code: SUBMISSION_LIMIT_CODE,
      count: MAX_SUBMISSIONS_PER_ROUND,
      max: MAX_SUBMISSIONS_PER_ROUND,
      message: "You ran out of builds for the week.",
    });
  });

  it("skips the cap for an unlimited submitter", async () => {
    isUnlimitedSubmitter.mockResolvedValue(true);
    SubmissionModel.countDocuments.mockResolvedValue(
      MAX_SUBMISSIONS_PER_ROUND,
    );
    await expect(
      assertUnderSubmissionLimit({
        anonymousId: "anon-owner-aaaaaaaa",
        firebaseUid: "uid-smahadkar",
        challengeDate: "2026-08-03",
      }),
    ).resolves.toBeUndefined();
    expect(SubmissionModel.countDocuments).not.toHaveBeenCalled();
  });

  it("allows a submit when the person is under the cap", async () => {
    SubmissionModel.countDocuments.mockResolvedValue(
      MAX_SUBMISSIONS_PER_ROUND - 1,
    );
    await expect(
      assertUnderSubmissionLimit({
        anonymousId: "anon-owner-aaaaaaaa",
        challengeDate: "2026-08-03",
      }),
    ).resolves.toBeUndefined();
  });
});
