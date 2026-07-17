import { Schema } from "mongoose";
import { getPlayConnection } from "../../db/playConnection.js";

const CHALLENGE_CATEGORIES = ["widget", "game", "tool", "other"] as const;
const CHALLENGE_STATUSES = ["draft", "published"] as const;

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
    timeLimitMinutes: {
      type: Number,
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
  },
  { timestamps: true },
);

ChallengeSchema.index({ status: 1, challengeDate: -1 });

export { CHALLENGE_CATEGORIES, CHALLENGE_STATUSES };

export function getPlayChallengeModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlayChallenge ||
    conn.model("PlayChallenge", ChallengeSchema)
  );
}
