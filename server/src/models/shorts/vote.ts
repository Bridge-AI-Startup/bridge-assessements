import { Schema, Types } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";

const VoteSchema = new Schema(
  {
    anonymousId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    challengeDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    winnerId: {
      type: Types.ObjectId,
      required: true,
      ref: "PlaySubmission",
    },
    loserId: {
      type: Types.ObjectId,
      required: true,
      ref: "PlaySubmission",
    },
    /** Canonical unordered pair key: `${minId}:${maxId}`. */
    pairKey: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Did this vote move the ratings? True iff the voter had submitted a build
     * for this challenge date. Anyone may play the matchups; only builders
     * count. `default: true` because every vote written before this field
     * existed came from a submitter — query with `{ $ne: false }` so a missing
     * field reads as weighted and no migration is needed.
     */
    weighted: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true },
);

VoteSchema.index(
  { anonymousId: 1, challengeDate: 1, pairKey: 1 },
  { unique: true },
);
VoteSchema.index({ challengeDate: 1, createdAt: -1 });
VoteSchema.index({ anonymousId: 1, challengeDate: 1, createdAt: 1 });

export function getPlayVoteModel() {
  const conn = getPlayConnection();
  return conn.models.PlayVote || conn.model("PlayVote", VoteSchema);
}

/** Per-voter round state for five-vote recaps (rank snapshots). */
const VoteRoundSchema = new Schema(
  {
    anonymousId: {
      type: String,
      required: true,
      trim: true,
    },
    challengeDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    roundIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    /** submissionId → { rank, score } at round start. */
    rankSnapshot: {
      type: Map,
      of: new Schema(
        {
          rank: { type: Number, required: true },
          score: { type: Number, required: true },
          displayName: { type: String, required: true },
        },
        { _id: false },
      ),
      default: {},
    },
    /** Submission ids that appeared in this round's pairs. */
    seenSubmissionIds: {
      type: [String],
      default: [],
    },
    votesInRound: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    completed: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true },
);

VoteRoundSchema.index(
  { anonymousId: 1, challengeDate: 1, roundIndex: 1 },
  { unique: true },
);

export function getPlayVoteRoundModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlayVoteRound ||
    conn.model("PlayVoteRound", VoteRoundSchema)
  );
}
