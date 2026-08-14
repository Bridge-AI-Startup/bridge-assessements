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

    /**
     * Evidence mode for this assessment — how we observe the candidate working.
     * Offered in the editor: "both" (default) or "none".
     *   "both"     — record the screen for playback, analyse the hook stream
     *   "none"     — no screen recording, no workflow capture
     * Leftover (still honoured): "workflow" (hooks only) and "screen" (video + OCR)
     *
     * New assessments default to "both". Documents with no field still resolve
     * to "screen" at read time (legacy video + OCR path).
     */
    evidenceMode: {
      type: String,
      enum: ["none", "workflow", "both", "screen"],
      default: "both",
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

