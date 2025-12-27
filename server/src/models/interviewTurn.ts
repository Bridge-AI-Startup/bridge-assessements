// server/models/interviewTurn.ts
import mongoose from "mongoose";

/**
 * InterviewTurn Model
 *
 * Represents one utterance in the interview transcript.
 * This model is append-only and serves as a historical record of the interview conversation.
 *
 * Purpose:
 * - Store the complete transcript of the interview conversation
 * - Track who said what (interviewer vs candidate)
 * - Link each turn to a specific question in the interview
 * - Provide chronological ordering of the conversation
 *
 * Important constraints:
 * - InterviewTurn documents are append-only (never update or overwrite)
 * - This model is only for transcript/history, not interview state
 * - Interview state is managed by InterviewSession model
 * - Each turn represents a single message/utterance in the conversation
 */
const InterviewTurnSchema = new mongoose.Schema(
  {
    // Reference to the interview session this turn belongs to
    // Links the turn to the InterviewSession that tracks interview progress
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },

    // Reference to the submission this interview is for
    // Provides quick access to submission data without populating session
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
      index: true,
    },

    // Role of the speaker in this turn
    // "interviewer": Question or follow-up from the interviewer/AI
    // "candidate": Response or answer from the candidate
    role: {
      type: String,
      enum: ["interviewer", "candidate"],
      required: true,
    },

    // Index of the question this turn is associated with
    // Matches the index in submission.interviewQuestions array
    // Used to track which question the turn relates to
    // For interviewer turns: the question being asked
    // For candidate turns: the answer to that question
    questionIndex: {
      type: Number,
      required: true,
      min: 0,
    },

    // The actual text content of this turn
    // For interviewer: the question text
    // For candidate: the candidate's response
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    // Note: createdAt is the primary timestamp for ordering turns
  }
);

// Compound index for efficient queries by session and chronological order
// Used to retrieve transcript in order: sessionId + createdAt
InterviewTurnSchema.index({ sessionId: 1, createdAt: 1 });

// Index for querying turns by submission and question
InterviewTurnSchema.index({ submissionId: 1, questionIndex: 1 });

const InterviewTurnModel = mongoose.model("InterviewTurn", InterviewTurnSchema);
export default InterviewTurnModel;

/**
 * Usage examples:
 *
 * // Create an interviewer turn (asking a question)
 * const interviewerTurn = await InterviewTurnModel.create({
 *   sessionId: session._id,
 *   submissionId: submission._id,
 *   role: "interviewer",
 *   questionIndex: 0,
 *   text: submission.interviewQuestions[0].prompt,
 * });
 *
 * // Create a candidate turn (answering)
 * const candidateTurn = await InterviewTurnModel.create({
 *   sessionId: session._id,
 *   submissionId: submission._id,
 *   role: "candidate",
 *   questionIndex: 0,
 *   text: "I chose async/await because...",
 * });
 *
 * // Retrieve full transcript for a session (in chronological order)
 * const transcript = await InterviewTurnModel.find({
 *   sessionId: session._id,
 * }).sort({ createdAt: 1 });
 *
 * // Get all turns for a specific question
 * const questionTurns = await InterviewTurnModel.find({
 *   sessionId: session._id,
 *   questionIndex: 2,
 * }).sort({ createdAt: 1 });
 */
