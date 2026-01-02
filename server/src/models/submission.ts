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
      index: true,
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
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Index for efficient queries
SubmissionSchema.index({ assessmentId: 1, status: 1 });
SubmissionSchema.index({ candidateEmail: 1 });
SubmissionSchema.index({ token: 1 }); // Already indexed via unique, but explicit for clarity

// Sparse index on interview.conversationId for faster lookup/debugging
// Sparse means it only indexes documents where conversationId exists
SubmissionSchema.index({ "interview.conversationId": 1 }, { sparse: true });

const SubmissionModel = mongoose.model("Submission", SubmissionSchema);
export default SubmissionModel;
