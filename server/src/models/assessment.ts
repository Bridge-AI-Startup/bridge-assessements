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

    // Scoring categories and their percent weights
    // Example: { "Code Quality": 25, "API Design": 25, "Testing": 15 }
    scoring: {
      type: Map,
      of: Number,
      default: new Map(),
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const AssessmentModel = mongoose.model("Assessment", AssessmentSchema);
export default AssessmentModel;

