/**
 * Workflow capture (hooks-first AI-collaboration capture).
 *
 * A candidate runs the capture kit inside the assessment repo; their AI coding
 * tool (Claude Code today) fires hooks that POST each prompt / tool call /
 * response here. This is the consented alternative to screen recording: we
 * capture the AI conversation and code-touching activity, not the desktop.
 *
 * Events live in their own collection rather than an array on the session:
 * a long session produces thousands of them, and unbounded subdocument arrays
 * are what OOMed the proctoring pipeline (see videoChunks history).
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export type WorkflowEventType =
  | "session_start"
  | "user_prompt"
  | "tool_use"
  | "tool_result"
  | "assistant_message"
  | "session_end"
  | "notification"
  /** What was visible on screen — derived from the recording, not the hooks. */
  | "screen_context";

export interface IWorkflowCaptureSession extends Document {
  _id: Types.ObjectId;
  /** Optional link to the assessment submission this capture belongs to. */
  submissionId?: Types.ObjectId;
  /** Candidate-facing submission token, if the kit was seeded from a real assessment. */
  submissionToken?: string;
  /** Secret the capture kit sends as a Bearer token. Never returned after creation. */
  captureToken: string;
  candidateName?: string;
  /** Tool that produced the events, e.g. "claude-code". */
  source: string;
  status: "pending" | "active" | "completed";
  consent: {
    granted: boolean;
    grantedAt?: Date | null;
    /** Version of the disclosure the candidate accepted. */
    disclosureVersion?: string | null;
  };
  startedAt?: Date | null;
  lastEventAt?: Date | null;
  completedAt?: Date | null;
  stats: {
    totalEvents: number;
    promptCount: number;
    toolUseCount: number;
    /** Bytes of payload accepted (post-truncation), for cost/abuse visibility. */
    payloadBytes: number;
  };
  /**
   * Optional screen recording for this capture session.
   *
   * The hook stream is the analysable record; this is purely so a reviewer can
   * *watch* a moment the timeline points at. Nothing here is transcribed or
   * OCR'd — that is the entire cost saving of the workflow approach.
   * `startedAt` is the sync origin: event offset = event.at - video.startedAt.
   */
  video?: {
    status: "not_started" | "recording" | "ready" | "failed";
    startedAt?: Date | null;
    endedAt?: Date | null;
    chunks: Array<{ storageKey: string; startTime: Date; sizeBytes: number }>;
    /**
     * One entry per start→stop span. Screen shares end for all sorts of
     * mundane reasons (switching apps, closing the shared tab), so recording
     * is resumable — and a resumed recording means wall-clock time no longer
     * maps linearly onto video time. Each segment records where it begins in
     * the merged video so events on either side of a gap still seek correctly.
     */
    segments: Array<{
      wallStartedAt: Date;
      wallEndedAt?: Date | null;
      videoOffsetStart: number;
      endReason?: string | null;
    }>;
    mergedKey?: string | null;
    mergedSizeBytes?: number;
    error?: string | null;
  };
  /**
   * Narrative segmentation of the session, computed once when capture ends.
   * Persisted rather than derived per request because it costs an LLM call —
   * recomputing on every dashboard poll would be both slow and expensive.
   */
  /** Shape produced by `groupIntoEpisodes`; stored Mixed (see schema note). */
  episodes?: Array<Record<string, unknown>>;
  episodesComputedAt?: Date | null;
  /** Environment facts the kit reports once, for context in review. */
  environment?: {
    cwd?: string | null;
    gitBranch?: string | null;
    gitRemote?: string | null;
    toolVersion?: string | null;
    platform?: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const workflowCaptureSessionSchema = new Schema<IWorkflowCaptureSession>(
  {
    submissionId: { type: Schema.Types.ObjectId, ref: "Submission", index: true },
    submissionToken: { type: String, index: true },
    captureToken: { type: String, required: true, unique: true, index: true },
    candidateName: { type: String, maxlength: 120 },
    source: { type: String, default: "claude-code" },
    status: {
      type: String,
      enum: ["pending", "active", "completed"],
      default: "pending",
      index: true,
    },
    consent: {
      granted: { type: Boolean, default: false },
      grantedAt: { type: Date, default: null },
      disclosureVersion: { type: String, default: null },
    },
    startedAt: { type: Date, default: null },
    lastEventAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    stats: {
      totalEvents: { type: Number, default: 0 },
      promptCount: { type: Number, default: 0 },
      toolUseCount: { type: Number, default: 0 },
      payloadBytes: { type: Number, default: 0 },
    },
    video: {
      status: {
        type: String,
        enum: ["not_started", "recording", "ready", "failed"],
        default: "not_started",
      },
      startedAt: { type: Date, default: null },
      endedAt: { type: Date, default: null },
      chunks: {
        type: [
          {
            _id: false,
            storageKey: String,
            startTime: Date,
            sizeBytes: Number,
          },
        ],
        default: [],
      },
      segments: {
        type: [
          {
            _id: false,
            wallStartedAt: Date,
            wallEndedAt: { type: Date, default: null },
            videoOffsetStart: { type: Number, default: 0 },
            endReason: { type: String, default: null },
          },
        ],
        default: [],
      },
      mergedKey: { type: String, default: null },
      mergedSizeBytes: { type: Number, default: 0 },
      error: { type: String, default: null },
    },
    // Mixed: the shape is produced and validated by groupIntoEpisodes (which
    // drops anything without usable evidence indices), and a nested subdocument
    // array here buys nothing but a fight with Mongoose's generics.
    episodes: {
      type: Schema.Types.Mixed,
      default: () => [],
    },
    episodesComputedAt: { type: Date, default: null },
    environment: {
      cwd: { type: String, default: null },
      gitBranch: { type: String, default: null },
      gitRemote: { type: String, default: null },
      toolVersion: { type: String, default: null },
      platform: { type: String, default: null },
    },
  },
  { timestamps: true }
);

export interface IWorkflowEvent extends Document {
  sessionId: Types.ObjectId;
  type: WorkflowEventType;
  /** When the event happened on the candidate's machine (kit-reported). */
  at: Date;
  /** Monotonic per-session counter assigned by the kit; used to detect gaps. */
  seq: number;
  /** Claude Code session id — one capture session can span several tool sessions. */
  toolSessionId?: string | null;
  toolName?: string | null;
  /** Prompt text, assistant text, or tool command — the human-readable core. */
  text?: string | null;
  /** Structured remainder of the hook payload (tool input/result, truncated). */
  payload?: Record<string, unknown> | null;
  /** True when the kit truncated `text`/`payload` to fit the size cap. */
  truncated: boolean;
  cwd?: string | null;
  gitBranch?: string | null;
  receivedAt: Date;
}

const workflowEventSchema = new Schema<IWorkflowEvent>({
  sessionId: {
    type: Schema.Types.ObjectId,
    ref: "WorkflowCaptureSession",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: [
      "session_start",
      "user_prompt",
      "tool_use",
      "tool_result",
      "assistant_message",
      "session_end",
      "notification",
      "screen_context",
    ],
    required: true,
  },
  at: { type: Date, required: true },
  seq: { type: Number, required: true },
  toolSessionId: { type: String, default: null },
  toolName: { type: String, default: null },
  text: { type: String, default: null },
  payload: { type: Schema.Types.Mixed, default: null },
  truncated: { type: Boolean, default: false },
  cwd: { type: String, default: null },
  gitBranch: { type: String, default: null },
  receivedAt: { type: Date, default: () => new Date() },
});

// Review reads the timeline in order; the unique pair also makes ingest idempotent
// so a retried batch from the kit's offline queue cannot double-insert.
workflowEventSchema.index({ sessionId: 1, seq: 1 }, { unique: true });
workflowEventSchema.index({ sessionId: 1, at: 1 });

/**
 * Latest known contents of each file the candidate has touched.
 *
 * The event stream is the history; this is the "what does the project look like
 * right now" view the interviewer agent needs without replaying every edit.
 * Updated from Write/Edit tool events and from the kit's periodic git snapshot
 * (which also catches files the candidate edited by hand, outside the agent).
 */
export interface IWorkflowFileState extends Document {
  sessionId: Types.ObjectId;
  path: string;
  content?: string | null;
  /** Set when content exceeded the per-file cap; `content` holds the head. */
  truncated: boolean;
  sizeBytes: number;
  /** "agent" = seen via a Write/Edit tool call; "snapshot" = git/file scan. */
  origin: "agent" | "snapshot";
  revision: number;
  updatedAt: Date;
}

const workflowFileStateSchema = new Schema<IWorkflowFileState>({
  sessionId: {
    type: Schema.Types.ObjectId,
    ref: "WorkflowCaptureSession",
    required: true,
    index: true,
  },
  path: { type: String, required: true },
  content: { type: String, default: null },
  truncated: { type: Boolean, default: false },
  sizeBytes: { type: Number, default: 0 },
  origin: { type: String, enum: ["agent", "snapshot"], default: "agent" },
  revision: { type: Number, default: 1 },
  updatedAt: { type: Date, default: () => new Date() },
});

workflowFileStateSchema.index({ sessionId: 1, path: 1 }, { unique: true });

export const WorkflowFileStateModel =
  mongoose.models.WorkflowFileState ||
  mongoose.model<IWorkflowFileState>("WorkflowFileState", workflowFileStateSchema);

export const WorkflowCaptureSessionModel =
  mongoose.models.WorkflowCaptureSession ||
  mongoose.model<IWorkflowCaptureSession>(
    "WorkflowCaptureSession",
    workflowCaptureSessionSchema
  );

export const WorkflowEventModel =
  mongoose.models.WorkflowEvent ||
  mongoose.model<IWorkflowEvent>("WorkflowEvent", workflowEventSchema);

export default WorkflowCaptureSessionModel;
