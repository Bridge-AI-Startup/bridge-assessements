import { beforeEach, describe, expect, it, vi } from "vitest";

// submissions.ts reaches the Shorts models, and shortsConnection.ts throws at
// import time without ATLAS_URI. The models themselves are mocked below.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/delete-submission-test";
});

const submissionDoc = {
  _id: "64b7f9c2e1a2b3c4d5e6f701",
  displayName: "Tide clock",
  challengeDate: "2026-08-03",
  deleteOne: vi.fn(async () => undefined),
};

const SubmissionModel = {
  findById: vi.fn(async () => submissionDoc as unknown),
};
const VoteModel = {
  deleteMany: vi.fn(async () => ({ deletedCount: 3 })),
};
const VoteRoundModel = {
  updateMany: vi.fn(async () => ({ modifiedCount: 2 })),
};

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => SubmissionModel,
}));
vi.mock("../../src/models/shorts/vote.js", () => ({
  getPlayVoteModel: () => VoteModel,
  getPlayVoteRoundModel: () => VoteRoundModel,
}));

const { deleteSubmission } = await import(
  "../../src/services/shorts/submissions.js"
);

const ID = "64b7f9c2e1a2b3c4d5e6f701";

describe("deleteSubmission", () => {
  beforeEach(() => {
    SubmissionModel.findById.mockClear();
    VoteModel.deleteMany.mockClear();
    VoteRoundModel.updateMany.mockClear();
    submissionDoc.deleteOne.mockClear();
    SubmissionModel.findById.mockResolvedValue(submissionDoc as unknown);
  });

  it("rejects an id that is not a Mongo id before touching the database", async () => {
    await expect(deleteSubmission("not-an-id")).rejects.toMatchObject({
      status: 400,
    });
    expect(SubmissionModel.findById).not.toHaveBeenCalled();
  });

  it("404s when the submission is already gone", async () => {
    SubmissionModel.findById.mockResolvedValue(null);
    await expect(deleteSubmission(ID)).rejects.toMatchObject({ status: 404 });
    expect(VoteModel.deleteMany).not.toHaveBeenCalled();
  });

  it("removes the build, its votes on either side, and reports the count", async () => {
    const result = await deleteSubmission(ID);

    expect(submissionDoc.deleteOne).toHaveBeenCalledTimes(1);
    // Votes count whether this build won or lost them.
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
