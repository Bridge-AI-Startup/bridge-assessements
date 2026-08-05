import { Schema } from "mongoose";
import { getPlayConnection } from "../../db/shortsConnection.js";

const BUILD_SESSION_STATUSES = [
  "provisioning",
  "active",
  "failed",
  "expired",
  "submitted",
] as const;

const BuildSessionSchema = new Schema(
  {
    anonymousId: {
      type: String,
      required: true,
      index: true,
      trim: true,
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
    status: {
      type: String,
      required: true,
      enum: BUILD_SESSION_STATUSES,
      default: "provisioning",
    },
    // Which "make" path built this session. Stamped at creation; read per-doc so
    // flipping SHORTS_MAKE_MODE never mis-routes an already-running session.
    // Absent on legacy docs → treated as "e2b".
    makeMode: {
      type: String,
      enum: ["e2b", "serverless"],
    },
    e2bSandboxId: {
      type: String,
      trim: true,
    },
    previewUrl: {
      type: String,
      trim: true,
    },
    tokenBudget: {
      type: Number,
      required: true,
      min: 1,
    },
    tokensUsed: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Same spend, split by direction — the budget still runs off `tokensUsed`
    // (their sum). Absent on sessions that predate the split, which is why the
    // UI only shows a breakdown when these are non-zero.
    inputTokensUsed: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    outputTokensUsed: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    llmProxyToken: {
      type: String,
      trim: true,
    },
    llmCalls: {
      type: Number,
      default: 0,
      min: 0,
    },
    startedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
    /**
     * When the builder opened the submit dialog. Stops the *submit* clock —
     * the finished work stays submittable for the hold window even if
     * `expiresAt` passes while they sign in or type a name. Building is not
     * extended: every build path still checks `expiresAt` on its own.
     */
    submitHoldAt: {
      type: Date,
    },
    error: {
      type: String,
    },
    chatMessages: {
      type: [
        {
          role: {
            type: String,
            enum: ["user", "assistant"],
            required: true,
          },
          text: {
            type: String,
            required: true,
          },
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    workspaceSnapshot: {
      type: [
        {
          path: { type: String, required: true },
          content: { type: String, required: true },
        },
      ],
      default: [],
    },
    workspaceSnapshotAt: {
      type: Date,
    },
    sandboxPaused: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

BuildSessionSchema.index({ anonymousId: 1, challengeDate: 1, status: 1 });

export { BUILD_SESSION_STATUSES };

export function getPlayBuildSessionModel() {
  const conn = getPlayConnection();
  return (
    conn.models.PlayBuildSession ||
    conn.model("PlayBuildSession", BuildSessionSchema)
  );
}
