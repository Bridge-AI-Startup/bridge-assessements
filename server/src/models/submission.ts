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
      enum: ["pending", "in-progress", "submitted", "expired"],
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
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Index for efficient queries
SubmissionSchema.index({ assessmentId: 1, status: 1 });
SubmissionSchema.index({ candidateEmail: 1 });
SubmissionSchema.index({ token: 1 }); // Already indexed via unique, but explicit for clarity

const SubmissionModel = mongoose.model("Submission", SubmissionSchema);
export default SubmissionModel;
