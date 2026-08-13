// server/models/assessment.ts
import mongoose from "mongoose";

const AssessmentSchema = new mongoose.Schema(
  {
    // Reference to the user who created this assessment
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Assessment title
    title: {
      type: String,
      required: true,
      trim: true,
    },

    // Assessment description
    description: {
      type: String,
      required: true,
      trim: true,
    },

    // Time limit in minutes
    timeLimit: {
      type: Number,
      required: true,
      min: 1, // At least 1 minute
    },

    // Number of interview questions to generate
    numInterviewQuestions: {
      type: Number,
      default: 2,
      min: 1,
      max: 4, // Maximum 4 questions
    },

    // GitHub link to starter files repository
    starterFilesGitHubLink: {
      type: String,
      default: null,
      trim: true,
    },

    // Inline starter code files (path + content per file)
    starterCodeFiles: {
      type: [
        {
          path: { type: String, required: true, trim: true },
          content: { type: String, default: "" },
        },
      ],
      default: undefined,
      select: true,
    },

    // Custom instructions for the AI interviewer
    interviewerCustomInstructions: {
      type: String,
      default: null,
      trim: true,
    },

    // Whether smart AI interviewer is enabled (legacy; product no longer runs voice interviews)
    isSmartInterviewerEnabled: {
      type: Boolean,
      default: false,
    },

    /**
     * Evidence mode for this assessment — how we observe the candidate working.
     *   "none"     — no screen recording, no workflow capture (default for new assessments)
     *   "workflow" — hooks-first AI-workflow capture via capture-kit
     *   "both"     — record the screen for playback, but analyse the hook stream
     *   "screen"   — legacy screen recording + AI transcript (kept so existing assessments still work)
     *
     * "workflow" and "both" additionally require the server-side
     * WORKFLOW_CAPTURE_ENABLED master switch, so an assessment can never
     * silently depend on an unconfigured deployment.
     */
    evidenceMode: {
      type: String,
      enum: ["none", "workflow", "both", "screen"],
      default: "none",
    },

    // Stack-agnostic observable behaviors (product-level bar for all candidates on this assessment)
    behavioralChecks: {
      type: [String],
      default: [],
    },

    // Evaluation criteria for grading submissions
    evaluationCriteria: {
      type: [String],
      default: [],
    },

    // Pre-grounded criteria (from grounder), keyed by criterion text for evaluation pipeline
    evaluationCriteriaGroundings: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const AssessmentModel = mongoose.model("Assessment", AssessmentSchema);
export default AssessmentModel;

