// server/models/interviewSession.ts
import mongoose from "mongoose";

/**
 * InterviewSession Model
 *
 * Tracks the runtime state of an interview session for a candidate submission.
 * This model is text/voice agnostic and focuses on progress tracking.
 *
 * Behavior expectations:
 * - One InterviewSession per Submission (enforced by unique index on submissionId)
 * - Session is created when the interview starts
 * - Session can be resumed if it exists and status is not "completed"
 * - currentQuestionIndex is the single source of truth for interview progress
 * - followupUsed resets to false when moving to the next question
 *
 * Note: This model does NOT store:
 * - Assessment description or rubric (available via Submission -> Assessment)
 * - GitHub repository data (available via Submission.githubRepo)
 * - Interview questions (generated on-demand or stored elsewhere)
 */
const InterviewSessionSchema = new mongoose.Schema(
  {
    // Reference to the submission this interview session belongs to
    // One-to-one relationship: each submission has at most one interview session
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
      unique: true, // Ensures one session per submission
      index: true,
    },

    // Current status of the interview session
    // "not_started": Session created but interview hasn't begun
    // "in_progress": Interview is actively ongoing
    // "completed": Interview has been finished
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed"],
      default: "not_started",
      required: true,
      index: true,
    },

    // Current position in the interview question sequence
    // This is the single source of truth for interview progress
    // Increments as the candidate moves through questions
    // Used to prevent repeating questions and track where to resume
    currentQuestionIndex: {
      type: Number,
      default: 0,
      required: true,
      min: 0,
    },

    // Whether a follow-up question has been used for the current question
    // Resets to false when moving to the next question (currentQuestionIndex increments)
    // Used to limit follow-ups deterministically (e.g., one follow-up per question)
    followupUsed: {
      type: Boolean,
      default: false,
      required: true,
    },

    // Timestamp when the interview session was started
    // Set when status changes from "not_started" to "in_progress"
    startedAt: {
      type: Date,
      default: null,
    },

    // Timestamp when the interview session was completed
    // Set when status changes to "completed"
    completedAt: {
      type: Date,
      default: null,
    },

    // Timestamp of the last activity/interaction in the session
    // Updated on each interaction to track session freshness
    // Useful for detecting abandoned sessions and implementing timeouts
    lastActivityAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Compound index for efficient queries by status and submission
InterviewSessionSchema.index({ submissionId: 1, status: 1 });

// Index for finding active sessions (useful for cleanup or monitoring)
InterviewSessionSchema.index({ status: 1, lastActivityAt: 1 });

const InterviewSessionModel = mongoose.model(
  "InterviewSession",
  InterviewSessionSchema
);
export default InterviewSessionModel;

/**
 * Usage examples:
 *
 * // Create a new interview session when interview starts
 * const session = await InterviewSessionModel.create({
 *   submissionId: submission._id,
 *   status: "in_progress",
 *   currentQuestionIndex: 0,
 *   followupUsed: false,
 *   startedAt: new Date(),
 *   lastActivityAt: new Date(),
 * });
 *
 * // Resume an existing session
 * const existingSession = await InterviewSessionModel.findOne({
 *   submissionId: submission._id,
 *   status: { $ne: "completed" },
 * });
 *
 * if (existingSession) {
 *   // Resume from currentQuestionIndex
 *   existingSession.lastActivityAt = new Date();
 *   await existingSession.save();
 * } else {
 *   // Create new session
 *   await InterviewSessionModel.create({ ... });
 * }
 *
 * // Move to next question (reset followupUsed)
 * session.currentQuestionIndex += 1;
 * session.followupUsed = false;
 * session.lastActivityAt = new Date();
 * await session.save();
 *
 * // Mark session as completed
 * session.status = "completed";
 * session.completedAt = new Date();
 * session.lastActivityAt = new Date();
 * await session.save();
 */
