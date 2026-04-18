import mongoose from "mongoose";

const SubmissionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assessment",
      required: true,
      index: true,
    },
    candidateName: { type: String, required: true, trim: true },
    /** Optional label shown on dashboards (e.g. "Ada L."). */
    displayName: { type: String, default: "", trim: true },
    candidateEmail: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: ["pending", "in-progress", "submitted", "opted-out", "expired"],
      default: "pending",
      index: true,
    },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    /** Minutes spent (set on submit from startedAt). */
    timeSpent: { type: Number, default: null },
    metadata: {
      ipAddress: { type: String },
      userAgent: { type: String },
    },
    /** Free-form notes when completing without GitHub (mini product). */
    submissionNotes: { type: String, default: "" },
    optedOut: { type: Boolean, default: false },
    optOutReason: { type: String, default: "" },
  },
  { timestamps: true },
);

SubmissionSchema.index({ assessmentId: 1, candidateEmail: 1 }, { unique: true });

export default mongoose.model("Submission", SubmissionSchema);
