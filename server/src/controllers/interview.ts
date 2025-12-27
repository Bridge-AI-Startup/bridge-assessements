import { RequestHandler } from "express";
import SubmissionModel from "../models/submission.js";
import InterviewSessionModel from "../models/interviewSession.js";
import InterviewTurnModel from "../models/interviewTurn.js";

/**
 * Start or resume an interview session
 *
 * This endpoint:
 * - Creates a new InterviewSession if one doesn't exist
 * - Resumes an existing session if it's in progress
 * - Creates the first interviewer turn if it doesn't exist
 * - Returns the current question to display
 *
 * InterviewSession holds the state (currentQuestionIndex, followupUsed, status)
 * InterviewTurn holds the history (transcript of all utterances)
 */
export const startInterview: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    // Step 1: Load the Submission
    const submission = await SubmissionModel.findById(submissionId);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Check if interview questions are ready
    if (
      !submission.interviewQuestions ||
      submission.interviewQuestions.length === 0
    ) {
      return res.status(409).json({
        error: "Interview questions not ready",
      });
    }

    // Step 2: Find or create InterviewSession
    // InterviewSession holds the state: currentQuestionIndex, followupUsed, status
    let session = await InterviewSessionModel.findOne({
      submissionId: submission._id,
    });

    if (!session) {
      // Create new session
      session = await InterviewSessionModel.create({
        submissionId: submission._id,
        status: "in_progress",
        currentQuestionIndex: 0,
        followupUsed: false,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });
      console.log(
        `✅ Created new interview session for submission ${submissionId}`
      );
    } else if (session.status === "completed") {
      return res.status(409).json({
        error: "Interview already completed",
      });
    } else if (session.status === "in_progress") {
      // Resume existing session - update lastActivityAt
      session.lastActivityAt = new Date();
      await session.save();
      console.log(`✅ Resumed interview session ${session._id}`);
    }

    // Step 3: Determine current question
    const currentQuestionIndex = session.currentQuestionIndex;
    const currentQuestion = submission.interviewQuestions[currentQuestionIndex];

    if (!currentQuestion) {
      return res.status(500).json({
        error: "Current question not found in submission",
      });
    }

    // Step 4: Check if interviewer turn already exists for this question
    // InterviewTurn holds the history - we check to avoid duplicates on resume
    const existingInterviewerTurn = await InterviewTurnModel.findOne({
      sessionId: session._id,
      questionIndex: currentQuestionIndex,
      role: "interviewer",
    });

    // Only create interviewer turn if it doesn't exist (prevents duplicates on resume)
    if (!existingInterviewerTurn) {
      await InterviewTurnModel.create({
        sessionId: session._id,
        submissionId: submission._id,
        role: "interviewer",
        questionIndex: currentQuestionIndex,
        text: currentQuestion.prompt,
      });
      console.log(
        `✅ Created interviewer turn for question ${currentQuestionIndex}`
      );
    }

    // Step 5: Return response
    res.status(200).json({
      sessionId: session._id.toString(),
      questionIndex: currentQuestionIndex,
      interviewerText: currentQuestion.prompt,
      totalQuestions: submission.interviewQuestions.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit a candidate answer and advance the interview
 *
 * This endpoint:
 * - Records the candidate's answer as an InterviewTurn (history)
 * - Advances InterviewSession state (currentQuestionIndex increments)
 * - Creates the next interviewer turn if there are more questions
 * - Marks session as completed if no questions remain
 *
 * The interview flow is deterministic:
 * - One candidate answer always advances exactly one question
 * - InterviewSession holds state, InterviewTurn holds history
 */
export const answerQuestion: RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    // Step 1: Load InterviewSession
    const session = await InterviewSessionModel.findById(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Interview session not found" });
    }

    if (session.status === "completed") {
      return res.status(409).json({
        error: "Interview already completed",
      });
    }

    // Step 2: Load Submission
    const submission = await SubmissionModel.findById(session.submissionId);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Step 3: Create candidate InterviewTurn (history)
    // This records the candidate's answer in the transcript
    await InterviewTurnModel.create({
      sessionId: session._id,
      submissionId: submission._id,
      role: "candidate",
      questionIndex: session.currentQuestionIndex,
      text: text.trim(),
    });
    console.log(
      `✅ Created candidate turn for question ${session.currentQuestionIndex}`
    );

    // Step 4: Advance interview state
    // InterviewSession holds the state - we update it deterministically
    session.currentQuestionIndex += 1;
    session.followupUsed = false; // Reset follow-up flag when moving to next question
    session.lastActivityAt = new Date();

    // Step 5: Check if there are more questions
    if (session.currentQuestionIndex < submission.interviewQuestions.length) {
      // More questions remain - create next interviewer turn and continue
      const nextQuestion =
        submission.interviewQuestions[session.currentQuestionIndex];

      // Create interviewer turn for the next question
      await InterviewTurnModel.create({
        sessionId: session._id,
        submissionId: submission._id,
        role: "interviewer",
        questionIndex: session.currentQuestionIndex,
        text: nextQuestion.prompt,
      });
      console.log(
        `✅ Created interviewer turn for question ${session.currentQuestionIndex}`
      );

      await session.save();

      res.status(200).json({
        done: false,
        questionIndex: session.currentQuestionIndex,
        interviewerText: nextQuestion.prompt,
      });
    } else {
      // No more questions - complete the interview
      session.status = "completed";
      session.completedAt = new Date();
      await session.save();

      console.log(`✅ Interview session ${sessionId} completed`);

      res.status(200).json({
        done: true,
        interviewerText: "Thanks — this completes the interview.",
      });
    }
  } catch (error) {
    next(error);
  }
};
