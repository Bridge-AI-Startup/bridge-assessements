// server/models/repoIndex.ts
import mongoose from "mongoose";

/**
 * RepoIndex Model
 *
 * Tracks the indexing state of a submission code snapshot for a submission.
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

    // Source discriminator for indexed code snapshot
    source: {
      type: String,
      enum: ["github", "upload"],
      default: "github",
      required: true,
      index: true,
    },

    // GitHub repository information (when source === "github")
    owner: {
      type: String,
      required: false,
      default: null,
      index: true,
    },
    repo: {
      type: String,
      required: false,
      default: null,
      index: true,
    },
    pinnedCommitSha: {
      type: String,
      required: false,
      default: null,
      index: true,
    },

    // Uploaded snapshot identity (when source === "upload")
    uploadSha256: {
      type: String,
      required: false,
      default: null,
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
RepoIndexSchema.index(
  { submissionId: 1, pinnedCommitSha: 1 },
  { partialFilterExpression: { source: "github", pinnedCommitSha: { $type: "string" } } }
);
RepoIndexSchema.index(
  { owner: 1, repo: 1, pinnedCommitSha: 1 },
  {
    partialFilterExpression: {
      source: "github",
      owner: { $type: "string" },
      repo: { $type: "string" },
      pinnedCommitSha: { $type: "string" },
    },
  }
);
RepoIndexSchema.index(
  { submissionId: 1, uploadSha256: 1 },
  { partialFilterExpression: { source: "upload", uploadSha256: { $type: "string" } } }
);

const RepoIndexModel = mongoose.model("RepoIndex", RepoIndexSchema);
export default RepoIndexModel;
