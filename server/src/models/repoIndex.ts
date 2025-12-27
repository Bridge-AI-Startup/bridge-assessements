// server/models/repoIndex.ts
import mongoose from "mongoose";

/**
 * RepoIndex Model
 *
 * Tracks the indexing state of a GitHub repository for a submission.
 * Serves as the control plane while Pinecone stores the actual vectors.
 */
const RepoIndexSchema = new mongoose.Schema(
  {
    // Reference to the submission this index belongs to
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
      index: true,
    },

    // GitHub repository information
    owner: {
      type: String,
      required: true,
      index: true,
    },
    repo: {
      type: String,
      required: true,
      index: true,
    },
    pinnedCommitSha: {
      type: String,
      required: true,
      index: true,
    },

    // Indexing status
    status: {
      type: String,
      enum: ["queued", "indexing", "ready", "failed"],
      default: "queued",
      required: true,
    },

    // Pinecone configuration
    pinecone: {
      indexName: {
        type: String,
        required: true,
      },
      namespace: {
        type: String,
        required: true,
      },
    },

    // Indexing statistics
    stats: {
      fileCount: {
        type: Number,
        default: 0,
      },
      chunkCount: {
        type: Number,
        default: 0,
      },
      totalChars: {
        type: Number,
        default: 0,
      },
      filesSkipped: {
        type: Number,
        default: 0,
      },
    },

    // Error information (only set if status is "failed")
    error: {
      message: {
        type: String,
        default: null,
      },
      stack: {
        type: String,
        default: null,
      },
      at: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Compound index for efficient lookups
RepoIndexSchema.index({ submissionId: 1, pinnedCommitSha: 1 });
RepoIndexSchema.index({ owner: 1, repo: 1, pinnedCommitSha: 1 });

const RepoIndexModel = mongoose.model("RepoIndex", RepoIndexSchema);
export default RepoIndexModel;
