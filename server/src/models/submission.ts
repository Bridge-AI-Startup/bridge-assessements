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

    // Scores (completeness, quality, etc.)
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

    // LLM Workflow Evaluation
    llmWorkflow: {
      // Interaction trace metadata
      trace: {
        sessionId: {
          type: String,
          unique: true,
          sparse: true,
          index: true,
        },
        events: [
          {
            timestamp: { type: Date, required: true },
            type: {
              type: String,
              enum: ["llm_call", "tool_call", "test_run", "file_change"],
              required: true,
            },
            model: String,
            provider: String,
            prompt: String,
            response: mongoose.Schema.Types.Mixed,
            tokens: {
              input: { type: Number, default: 0 },
              output: { type: Number, default: 0 },
              total: { type: Number, default: 0 },
            },
            latency: Number, // milliseconds
            cost: Number, // USD estimate
            metadata: mongoose.Schema.Types.Mixed,
          },
        ],
        totalTokens: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        totalTime: { type: Number, default: 0 }, // milliseconds
        totalCalls: { type: Number, default: 0 },
      },

      // Task execution results
      taskResults: [
        {
          taskId: { type: String, required: true },
          taskName: { type: String, required: true },
          status: {
            type: String,
            enum: ["passed", "failed", "timeout", "error"],
            required: true,
          },
          testResults: {
            passed: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
            failures: [
              {
                testName: String,
                error: String,
                output: String,
              },
            ],
          },
          executionTime: Number, // milliseconds
          output: mongoose.Schema.Types.Mixed,
          gitDiff: String,
          fileChanges: [
            {
              path: String,
              changeType: String, // "added", "modified", "deleted"
            },
          ],
        },
      ],

      // Workflow scores (5 dimensions)
      scores: {
        correctness: {
          score: { type: Number, min: 0, max: 40, default: null },
          breakdown: {
            testPassRate: { type: Number, default: null },
            edgeCaseHandling: { type: Number, default: null },
            reliability: { type: Number, default: null },
          },
          evidence: {
            passingTests: { type: Number, default: 0 },
            failingTests: { type: Number, default: 0 },
            totalTests: { type: Number, default: 0 },
            rerunConsistency: { type: Number, default: null },
          },
        },
        efficiency: {
          score: { type: Number, min: 0, max: 20, default: null },
          breakdown: {
            costPerTask: { type: Number, default: null },
            timeToGreen: { type: Number, default: null },
            turnEfficiency: { type: Number, default: null },
          },
          evidence: {
            totalCost: { type: Number, default: 0 },
            totalTime: { type: Number, default: 0 },
            totalTurns: { type: Number, default: 0 },
            retryCount: { type: Number, default: 0 },
            cacheHits: { type: Number, default: 0 },
          },
        },
        promptQuality: {
          score: { type: Number, min: 0, max: 15, default: null },
          breakdown: {
            clarity: { type: Number, default: null },
            decomposition: { type: Number, default: null },
            feedbackUsage: { type: Number, default: null },
          },
          evidence: {
            constraintSpecification: { type: Boolean, default: false },
            verificationPrompts: { type: Number, default: 0 },
            clarificationRequests: { type: Number, default: 0 },
            thrashDetected: { type: Boolean, default: false },
            promptExcerpts: [String],
          },
        },
        structure: {
          score: { type: Number, min: 0, max: 20, default: null },
          breakdown: {
            modularity: { type: Number, default: null },
            configurability: { type: Number, default: null },
            observability: { type: Number, default: null },
            resilience: { type: Number, default: null },
          },
          evidence: {
            moduleCount: { type: Number, default: 0 },
            configFiles: { type: Number, default: 0 },
            logStatements: { type: Number, default: 0 },
            errorHandlers: { type: Number, default: 0 },
            retryPatterns: { type: Number, default: 0 },
          },
        },
        reliability: {
          score: { type: Number, min: 0, max: 5, default: null },
          breakdown: {
            failureHandling: { type: Number, default: null },
            safety: { type: Number, default: null },
          },
          evidence: {
            gracefulFailures: { type: Number, default: 0 },
            secretLeaks: { type: Number, default: 0 },
            unsafeInstructions: { type: Number, default: 0 },
          },
        },
        overall: {
          score: { type: Number, min: 0, max: 100, default: null },
          confidence: { type: Number, min: 0, max: 1, default: null },
          reasonCodes: [String],
        },
        calculatedAt: { type: Date, default: null },
        calculationVersion: { type: String, default: null },
      },

      // Evaluation metadata
      evaluation: {
        harnessVersion: { type: String, default: "1.0.0" },
        tasksCompleted: { type: Number, default: 0 },
        tasksTotal: { type: Number, default: 0 },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
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

// Index for LLM workflow trace sessionId
SubmissionSchema.index({ "llmWorkflow.trace.sessionId": 1 }, { sparse: true });

const SubmissionModel = mongoose.model("Submission", SubmissionSchema);
export default SubmissionModel;
