import mongoose from "mongoose";

const ProctoringSessionSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["pending", "active", "paused", "completed", "failed"],
      default: "pending",
    },
    consent: {
      granted: { type: Boolean, default: false },
      grantedAt: { type: Date, default: null },
      screens: { type: Number, default: 0 },
    },
    screens: [
      {
        screenIndex: { type: Number, required: true },
        label: { type: String, default: null },
        width: { type: Number, default: null },
        height: { type: Number, default: null },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    frames: [
      {
        storageKey: { type: String, required: true },
        screenIndex: { type: Number, required: true },
        capturedAt: { type: Date, required: true },
        sizeBytes: { type: Number, default: 0 },
        width: { type: Number, default: null },
        height: { type: Number, default: null },
        isDuplicate: { type: Boolean, default: false },
        clientHash: { type: String, default: null },
      },
    ],
    sidecarEvents: [
      {
        type: {
          type: String,
          enum: [
            "tab_switch",
            "window_blur",
            "window_focus",
            "clipboard_copy",
            "clipboard_paste",
            "url_change",
            "idle_start",
            "idle_end",
            "stream_lost",
            "stream_restored",
          ],
          required: true,
        },
        timestamp: { type: Date, required: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],
    transcript: {
      status: {
        type: String,
        enum: ["not_started", "generating", "completed", "failed"],
        default: "not_started",
      },
      /** When starting a new generation we set this; only the run that matches it may write completion/failure (allows "regenerate from scratch" to supersede in-flight run). */
      generationId: { type: Number, default: null },
      storageKey: { type: String, default: null },
      generatedAt: { type: Date, default: null },
      error: { type: String, default: null },
      frameCount: { type: Number, default: 0 },
      /** Progress during generation (status === "generating"). Polled by clients. */
      progressTotalFrames: { type: Number, default: null },
      progressFramesProcessed: { type: Number, default: null },
      progressBatchIndex: { type: Number, default: null },
      progressTotalBatches: { type: Number, default: null },
      tokenUsage: {
        prompt: { type: Number, default: 0 },
        completion: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      // Refined transcript (AI post-processing of raw OCR)
      refinedStatus: {
        type: String,
        enum: ["not_started", "generating", "completed", "failed"],
        default: "not_started",
      },
      refinedStorageKey: { type: String, default: null },
      refinedAt: { type: Date, default: null },
      refinedError: { type: String, default: null },
      refinedTokenUsage: {
        prompt: { type: Number, default: 0 },
        completion: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      /** Last time incremental (sliding-window) transcript generation ran for this session. */
      lastIncrementalAt: { type: Date, default: null },
    },
    videoChunks: [
      {
        storageKey: { type: String, required: true },
        screenIndex: { type: Number, required: true },
        startTime: { type: Date, required: true },
        endTime: { type: Date, default: null },
        sizeBytes: { type: Number, default: 0 },
      },
    ],
    stats: {
      totalFrames: { type: Number, default: 0 },
      uniqueFrames: { type: Number, default: 0 },
      duplicatesSkipped: { type: Number, default: 0 },
      totalSizeBytes: { type: Number, default: 0 },
      captureStartedAt: { type: Date, default: null },
      captureEndedAt: { type: Date, default: null },
      videoStats: {
        totalChunks: { type: Number, default: 0 },
        totalVideoSizeBytes: { type: Number, default: 0 },
        extractedFrameCount: { type: Number, default: 0 },
        extractionMethod: {
          type: String,
          enum: ["scene_detection", "fixed_interval", "screenshot_fallback", null],
          default: null,
        },
      },
    },
    companion: {
      status: {
        type: String,
        enum: ["not_started", "active", "completed", "failed"],
        default: "not_started",
      },
      conversationId: { type: String, default: null },
      startedAt: { type: Date, default: null },
      endedAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
  },
  { timestamps: true }
);

ProctoringSessionSchema.index({ submissionId: 1 }, { unique: true });
ProctoringSessionSchema.index({ token: 1 });
ProctoringSessionSchema.index({ status: 1 });

const ProctoringSessionModel = mongoose.model(
  "ProctoringSession",
  ProctoringSessionSchema
);
export default ProctoringSessionModel;
