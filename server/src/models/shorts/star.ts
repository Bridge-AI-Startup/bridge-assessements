import { Schema, Types } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";

/**
 * A private bookmark: this person saved that build to play later. Deliberately
 * no public count surface — a visible star tally on gallery cards would anchor
 * votes the same way visible ratings would (the Vote page hides scores
 * mid-vote for exactly that reason).
 */
const StarSchema = new Schema(
  {
    anonymousId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Stamped when the starrer was signed in; account-level owner tag. */
    firebaseUid: {
      type: String,
      trim: true,
    },
    submissionId: {
      type: Types.ObjectId,
      required: true,
      ref: "PlaySubmission",
    },
    challengeDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
  },
  { timestamps: true },
);

StarSchema.index({ anonymousId: 1, submissionId: 1 }, { unique: true });
StarSchema.index({ firebaseUid: 1, createdAt: -1 }, { sparse: true });
// Cleanup path: delete every star pointing at a removed submission.
StarSchema.index({ submissionId: 1 });

export function getPlayStarModel() {
  const conn = getPlayConnection();
  return conn.models.PlayStar || conn.model("PlayStar", StarSchema);
}
