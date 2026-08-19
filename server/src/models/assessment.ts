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
     * Leftover (still honoured): "workflow" (hooks only)
     *
     * New assessments default to "both". Documents with no field — or holding
     * the removed "screen" value — resolve to "both" at read time via
     * `resolveEvidenceMode`, so nothing has to be migrated for correctness.
     * The enum no longer accepts "screen"; run
     * `scripts/migrateEvidenceModeOffScreen.ts` so stored values match, or an
     * unmigrated document fails validation the next time it is saved.
     */
    evidenceMode: {
      type: String,
      enum: ["none", "workflow", "both"],
      default: "both",
    },

    // Stack-agnostic observable behaviors (product-level bar for all candidates on this assessment)
    behavioralChecks: {
      type: [String],
      default: [],
    },

    /**
     * Optional per-check verification specs — how a given sentence in
     * `behavioralChecks` is settled (`agent` = LLM judge, or a deterministic
     * http / http_sequence / restart_persistence / cli / ui acceptance).
     *
     * Mixed, and validated by Zod at the boundary
     * (`behavioralGrading/checkSpecs.ts`) rather than by Mongoose, so the
     * acceptance shapes evolve without a schema migration. Never read this field
     * directly — resolve through `resolveBehavioralCheckSpecs`, which keeps the
     * plain-language list authoritative.
     */
    behavioralCheckSpecs: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
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

    /**
     * Persisted per-criterion evaluability verdicts, keyed by criterion text +
     * profile. Written once (lazily, on first grading) by
     * `ensureCriteriaValidations` and reused for every candidate afterwards.
     * Grading used to re-ask an LLM "is this criterion scoreable?" on every
     * run, so the same criterion could be graded for one candidate and refused
     * as non-evaluable for the next. Editing a criterion's text invalidates its
     * entry naturally (lookup is by exact text).
     */
    evaluationCriteriaValidations: {
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

