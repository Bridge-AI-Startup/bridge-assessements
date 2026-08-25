import { Schema } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";

const CHALLENGE_CATEGORIES = ["widget", "game", "tool", "other"] as const;
const CHALLENGE_STATUSES = ["draft", "published"] as const;
const CHALLENGE_MAKE_MODES = ["e2b", "serverless"] as const;

const ChallengeSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9-]+$/,
    },
    challengeDate: {
      type: String,
      required: true,
      unique: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    title: {
      type: String,
      required: true,
      maxlength: 120,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    tokenBudget: {
      type: Number,
      required: true,
      min: 1,
    },
    category: {
      type: String,
      required: true,
      enum: CHALLENGE_CATEGORIES,
    },
    status: {
      type: String,
      required: true,
      enum: CHALLENGE_STATUSES,
      default: "draft",
    },
    /**
     * The one challenge currently served by Shorts. Round changes are manual:
     * publishing or changing challengeDate never activates a challenge.
     */
    isActive: {
      type: Boolean,
      required: true,
      default: false,
    },
    activatedAt: {
      type: Date,
    },
    deactivatedAt: {
      type: Date,
    },
    // Which build path this challenge uses. Unset → fall back to SHORTS_MAKE_MODE.
    makeMode: {
      type: String,
      enum: CHALLENGE_MAKE_MODES,
    },
  },
  { timestamps: true },
);

ChallengeSchema.index({ status: 1, challengeDate: -1 });
ChallengeSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export { CHALLENGE_CATEGORIES, CHALLENGE_STATUSES, CHALLENGE_MAKE_MODES };

export function getPlayChallengeModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlayChallenge ||
    conn.model("PlayChallenge", ChallengeSchema)
  );
}
