import { Schema, Types } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";
import {
  INITIAL_RANKING_SCORE,
  INITIAL_RATING_DEVIATION,
  INITIAL_RATING_MEAN,
} from "../../services/shorts/ratingConstants.js";

const SubmissionFileSchema = new Schema(
  {
    path: { type: String, required: true, trim: true },
    content: { type: String, required: true },
  },
  { _id: false },
);

const SubmissionSchema = new Schema(
  {
    anonymousId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    /**
     * Set when the builder was signed in at submit time. `anonymousId` stays
     * the browser-level owner tag (isMine, self-vote exclusion); this is the
     * account-level one, so a build submitted while signed in follows the
     * account even if that browser's id is never linked again.
     */
    firebaseUid: {
      type: String,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    challengeSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    challengeDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    sessionId: {
      type: Types.ObjectId,
      required: true,
    },
    files: {
      type: [SubmissionFileSchema],
      required: true,
      default: [],
    },
    fileCount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    /** TrueSkill-style skill mean (μ). */
    ratingMean: {
      type: Number,
      required: true,
      default: INITIAL_RATING_MEAN,
    },
    /** TrueSkill-style skill uncertainty (σ). */
    ratingDeviation: {
      type: Number,
      required: true,
      default: INITIAL_RATING_DEVIATION,
    },
    /** Conservative rank key: μ − 3σ. */
    rankingScore: {
      type: Number,
      required: true,
      default: INITIAL_RANKING_SCORE,
    },
    wins: { type: Number, required: true, default: 0, min: 0 },
    losses: { type: Number, required: true, default: 0, min: 0 },
    matches: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Submissions are independent entries: one builder may submit several builds
// for the same challenge (capped at MAX_SUBMISSIONS_PER_ROUND), each rated on
// its own. Non-unique lookup index backs the "my submissions" view.
SubmissionSchema.index({ anonymousId: 1, challengeDate: 1, submittedAt: -1 });
// Account history: builds submitted while signed in, regardless of browser id.
SubmissionSchema.index({ firebaseUid: 1, submittedAt: -1 }, { sparse: true });
SubmissionSchema.index({ challengeDate: -1, submittedAt: -1 });
SubmissionSchema.index({ challengeDate: 1, rankingScore: -1 });

export function getPlaySubmissionModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlaySubmission ||
    conn.model("PlaySubmission", SubmissionSchema)
  );
}
