// server/models/submission.ts
import mongoose from "mongoose";
import crypto from "crypto";

const SubmissionSchema = new mongoose.Schema(
  {
    // Unique token for accessing this submission (generated when link is created)
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(32).toString("hex"), // Generate 64-character hex token
    },

    // Reference to the assessment this submission is for
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: true,
      index: true,
    },

    // Candidate information
    candidateName: {
      type: String,
      trim: true,
    },

    candidateEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },

    // Submission status
    status: {
      type: String,
      enum: ["pending", "in-progress", "submitted", "expired", "opted-out"],
      default: "pending", // Created when link is generated, changes to "in-progress" when candidate starts
      required: true,
      index: true,
    },

    // When the candidate started the assessment
    startedAt: {
      type: Date,
      default: null, // Will be set when candidate starts the assessment
    },

    // When the candidate submitted the assessment
    submittedAt: {
      type: Date,
      default: null,
    },

    // Time spent in minutes
    timeSpent: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Source of candidate code submission. Legacy records default to GitHub.
    codeSource: {
      type: String,
      enum: ["github", "upload"],
      default: "github",
      required: true,
    },

    // Metadata for uploaded code archives (when codeSource === "upload")
    codeUpload: {
      storageKey: {
        type: String,
        default: null,
      },
      originalFilename: {
        type: String,
        default: null,
      },
      sizeBytes: {
        type: Number,
        default: null,
      },
      sha256: {
        type: String,
        default: null,
      },
      uploadedAt: {
        type: Date,
        default: null,
      },
    },

    // GitHub repository link
    githubLink: {
      type: String,
      trim: true,
      default: null,
    },

    // GitHub repository information (parsed and resolved)
    githubRepo: {
      owner: {
        type: String,
        default: null,
      },
      repo: {
        type: String,
        default: null,
      },
      refType: {
        type: String,
        enum: ["commit", "branch"],
        default: null,
      },
      ref: {
        type: String,
        default: null,
      },
      pinnedCommitSha: {
        type: String,
        default: null,
      },
    },

    // Interview questions generated from the candidate's code submission
    // Stored after repo is pinned to commit and before interviews can start
    interviewQuestions: [
      {
        prompt: {
          type: String,
          required: true,
          trim: true,
        },
        anchors: {
          type: [
            {
              path: {
                type: String,
                required: true,
              },
              startLine: {
                type: Number,
                required: true,
                min: 1,
              },
              endLine: {
                type: Number,
                required: true,
                min: 1,
              },
            },
          ],
          default: [],
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Opt-out information
    optedOut: {
      type: Boolean,
      default: false,
    },
    optOutReason: {
      type: String,
      trim: true,
      default: null,
    },
    optedOutAt: {
      type: Date,
      default: null,
    },

    // Optional metadata
    metadata: {
      ipAddress: {
        type: String,
        default: null,
      },
      userAgent: {
        type: String,
        default: null,
      },
    },

    // Interview transcription and analysis data
    interview: {
      // Provider of the interview service (e.g., "elevenlabs")
      provider: {
        type: String,
        default: "elevenlabs",
      },
      // Interview status
      status: {
        type: String,
        enum: ["not_started", "in_progress", "completed", "failed"],
        default: "not_started",
      },
      // ElevenLabs conversation ID (for webhook attribution)
      conversationId: {
        type: String,
        default: null,
      },
      // Transcript data
      transcript: {
        turns: {
          type: [
            {
              role: {
                type: String,
                enum: ["agent", "candidate"],
                required: true,
              },
              text: {
                type: String,
                required: true,
                trim: true,
              },
              startMs: {
                type: Number,
                default: null,
              },
              endMs: {
                type: Number,
                default: null,
              },
            },
          ],
          default: [],
        },
      },
      // Summary of the interview (optional)
      summary: {
        type: String,
        default: null,
      },
      // Raw analysis data from provider (optional, mixed type)
      analysis: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
      // Timestamps
      startedAt: {
        type: Date,
        default: null,
      },
      completedAt: {
        type: Date,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
      // Error information (if interview failed)
      error: {
        message: {
          type: String,
          default: null,
        },
        at: {
          type: Date,
          default: null, // Only set when there's an actual error
        },
        raw: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },
      },
    },

    // Legacy scores bag (orphaned Trace/completeness fields may remain on old Mongo docs; not written by app logic)
    scores: {
      overall: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      completeness: {
        score: { type: Number, min: 0, max: 100, default: null },
        breakdown: {
          requirementsMet: { type: Number, default: 0 },
          totalRequirements: { type: Number, default: 0 },
          details: mongoose.Schema.Types.Mixed,
        },
        calculatedAt: { type: Date, default: null },
      },
      calculatedAt: { type: Date, default: null },
      calculationVersion: { type: String, default: null },
    },

    // Screen recording transcript (Stage 1 VLM output: array of TranscriptEvent)
    screenRecordingTranscript: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Enriched transcript (output of the activity interpreter)
    enrichedTranscript: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Time-aware refined transcript (interpretation + temporal insights + hybrid eval events)
    refinedTranscript: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Evaluation report (result of the full evaluation pipeline)
    evaluationReport: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // 'pending' = background evaluation running after submit; 'completed' | 'failed' when done; null/absent = idle
    evaluationStatus: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: null,
    },

    // When evaluation did not run or failed: short reason for UI (e.g. "No proctoring session", "Assessment has no evaluation criteria")
    evaluationError: {
      type: String,
      default: null,
    },

    // Behavioral grading report (E2B + behavioral checks)
    behavioralGradingReport: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // 'pending' = background behavioral grading running after submit; 'completed' | 'failed' when done; null/absent = idle
    behavioralGradingStatus: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: null,
    },

    // Short error reason for behavioral grading failures
    behavioralGradingError: {
      type: String,
      default: null,
    },

    // Live progress during behavioral grading (stress-demo simulation + future streaming)
    behavioralGradingProgress: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Candidate-authored runtime config (Railway-style). Secrets live here write-only.
    runtimeConfig: {
      rootDir: { type: String, default: "." },
      runtime: {
        type: String,
        enum: ["auto", "node20", "python312"],
        default: "auto",
      },
      installCommand: { type: String, default: "" },
      buildCommand: { type: String, default: null },
      startCommand: { type: String, default: "" },
      port: { type: Number, default: null },
      healthPath: { type: String, default: null },
      executionProfile: {
        type: String,
        enum: ["cli_stdout", "web_server", "unclear"],
        default: "unclear",
      },
      envVars: {
        type: [
          {
            key: { type: String, required: true },
            value: { type: String, default: "" },
            secret: { type: Boolean, default: false },
          },
        ],
        default: [],
      },
      declaredEgressDomains: { type: [String], default: [] },
    },

    runtimeSetup: {
      status: {
        type: String,
        enum: ["not_started", "in_progress", "finalized"],
        default: "not_started",
      },
      verified: { type: Boolean, default: false },
      lastRunAt: { type: Date, default: null },
      lastRunResult: {
        ok: { type: Boolean, default: null },
        exitCode: { type: Number, default: null },
        error: { type: String, default: null },
        startedAt: { type: Date, default: null },
        endedAt: { type: Date, default: null },
      },
      finalizedAt: { type: Date, default: null },
      snapshotSha256: { type: String, default: null },
      // Snapshot of the setup box taken at finalize, so a recruiter can read
      // what "verified" means without paying to boot a sandbox.
      evidence: {
        healthOk: { type: Boolean, default: null },
        healthSummary: { type: String, default: null },
        port: { type: Number, default: null },
        capturedAt: { type: Date, default: null },
        logTail: {
          type: [
            {
              stream: { type: String, default: "stdout" },
              text: { type: String, default: "" },
              t: { type: Date, default: null },
            },
          ],
          default: [],
        },
      },
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Index for efficient queries
SubmissionSchema.index({ assessmentId: 1, status: 1 });
SubmissionSchema.index({ assessmentId: 1, candidateEmail: 1 });
SubmissionSchema.index({ candidateEmail: 1 });

// Sparse index on interview.conversationId for faster lookup/debugging
// Sparse means it only indexes documents where conversationId exists
SubmissionSchema.index({ "interview.conversationId": 1 }, { sparse: true });

const SubmissionModel = mongoose.model("Submission", SubmissionSchema);
export default SubmissionModel;
