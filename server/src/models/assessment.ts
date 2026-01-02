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

    // Custom instructions for the AI interviewer
    interviewerCustomInstructions: {
      type: String,
      default: null,
      trim: true,
    },

    // Whether smart AI interviewer is enabled
    isSmartInterviewerEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const AssessmentModel = mongoose.model("Assessment", AssessmentSchema);
export default AssessmentModel;

