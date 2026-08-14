import mongoose from "mongoose";

export const RUNTIME_SETUP_SESSION_STATUSES = [
  "provisioning",
  "running",
  "paused",
  "dead",
] as const;

export const RUNTIME_SETUP_RUN_PHASES = [
  "idle",
  "installing",
  "building",
  "starting",
  "waiting_health",
  "ready",
  "failed",
] as const;

export const RUNTIME_SETUP_SESSION_KINDS = ["setup", "replay"] as const;

const LogLineSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true },
    t: { type: Date, required: true },
    stream: {
      type: String,
      enum: ["stdout", "stderr", "system"],
      required: true,
    },
    text: { type: String, required: true },
  },
  { _id: false }
);

const RuntimeSetupSessionSchema = new mongoose.Schema(
  {
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: RUNTIME_SETUP_SESSION_KINDS,
      default: "setup",
    },
    e2bSandboxId: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: RUNTIME_SETUP_SESSION_STATUSES,
      default: "provisioning",
      index: true,
    },
    runPhase: {
      type: String,
      enum: RUNTIME_SETUP_RUN_PHASES,
      default: "idle",
    },
    repoPath: {
      type: String,
      default: null,
    },
    port: {
      type: Number,
      default: null,
    },
    previewUrl: {
      type: String,
      default: null,
      trim: true,
    },
    health: {
      ok: { type: Boolean, default: false },
      summary: { type: String, default: null },
      checkedAt: { type: Date, default: null },
    },
    startedAt: {
      type: Date,
      default: null,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    error: { type: String, default: null },
    logSeq: { type: Number, default: 0 },
    logLines: { type: [LogLineSchema], default: [] },
    codeLoaded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

RuntimeSetupSessionSchema.index(
  { submissionId: 1, kind: 1 },
  { unique: true }
);

const RuntimeSetupSessionModel = mongoose.model(
  "RuntimeSetupSession",
  RuntimeSetupSessionSchema
);

export default RuntimeSetupSessionModel;
