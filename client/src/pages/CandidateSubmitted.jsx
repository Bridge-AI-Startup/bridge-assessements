import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Link as LinkIcon,
  Clock,
  Calendar,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getSubmissionByToken,
  generateInterviewQuestionsByToken,
  startInterview,
  answerInterviewQuestion,
} from "@/api/submission";
import { createPageUrl } from "@/utils";
import ElevenLabsInterviewClient from "@/components/ElevenLabsInterviewClient";

export default function CandidateSubmitted() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingInterview, setIsGeneratingInterview] = useState(false);
  const [interviewError, setInterviewError] = useState(null);

  // Interview state
  const [sessionId, setSessionId] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(null);
  const [totalQuestions, setTotalQuestions] = useState(null);
  const [interviewerText, setInterviewerText] = useState("");
  const [candidateAnswer, setCandidateAnswer] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isInterviewCompleted, setIsInterviewCompleted] = useState(false);

  useEffect(() => {
    if (!token) {
      // If no token, redirect to landing
      navigate(createPageUrl("Landing"));
      return;
    }

    const loadSubmission = async () => {
      setIsLoading(true);
      try {
        const result = await getSubmissionByToken(token);
        if (result.success) {
          setSubmission(result.data);
          const assessmentData = result.data.assessmentId;
          if (typeof assessmentData === "object" && assessmentData !== null) {
            setAssessment(assessmentData);
          }

          // If submission is not submitted, redirect back to assessment
          if (
            result.data.status !== "submitted" &&
            result.data.status !== "expired"
          ) {
            navigate(`${createPageUrl("CandidateAssessment")}?token=${token}`);
          }
        } else {
          console.error("Failed to load submission");
        }
      } catch (error) {
        console.error("Error loading submission:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSubmission();
  }, [token, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!submission || !assessment) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load submission</p>
        </div>
      </div>
    );
  }

  const isExpired = submission.status === "expired";

  const handleGenerateInterview = async () => {
    if (!token || !submission?._id) return;

    setIsGeneratingInterview(true);
    setInterviewError(null);
    setTranscript([]);
    setCandidateAnswer("");
    setIsInterviewCompleted(false);

    try {
      // Step 1: Generate interview questions
      const generateResult = await generateInterviewQuestionsByToken(token);

      if (!generateResult.success) {
        setInterviewError(
          generateResult.error || "Failed to generate interview questions"
        );
        setIsGeneratingInterview(false);
        return;
      }

      // Step 2: Automatically start the interview after questions are generated
      const startResult = await startInterview(submission._id);

      if (!startResult.success) {
        // Try to extract a user-friendly error message
        let errorMessage = startResult.error || "Failed to start interview";

        // Check for specific error cases
        if (
          errorMessage.includes("not ready") ||
          errorMessage.includes("409")
        ) {
          errorMessage =
            "Interview questions were generated but could not be started. Please try again.";
        } else if (errorMessage.includes("already completed")) {
          errorMessage = "This interview has already been completed.";
        }

        setInterviewError(errorMessage);
        setIsGeneratingInterview(false);
        return;
      }

      // Interview started successfully
      setSessionId(startResult.data.sessionId);
      setCurrentQuestionIndex(startResult.data.questionIndex);
      setTotalQuestions(startResult.data.totalQuestions);
      setInterviewerText(startResult.data.interviewerText);

      // Add first question to transcript
      setTranscript([
        {
          role: "interviewer",
          text: startResult.data.interviewerText,
        },
      ]);

      setIsGeneratingInterview(false);
    } catch (err) {
      console.error("Error generating/starting interview:", err);
      setInterviewError(err.message || "An unexpected error occurred");
      setIsGeneratingInterview(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!sessionId || !candidateAnswer.trim() || isInterviewCompleted) {
      return;
    }

    setIsSubmittingAnswer(true);
    setInterviewError(null);

    try {
      const result = await answerInterviewQuestion(
        sessionId,
        candidateAnswer.trim()
      );

      if (!result.success) {
        setInterviewError(result.error || "Failed to submit answer");
        setIsSubmittingAnswer(false);
        return;
      }

      // Add candidate answer to transcript
      setTranscript((prev) => [
        ...prev,
        {
          role: "candidate",
          text: candidateAnswer.trim(),
        },
      ]);

      // Clear answer input
      setCandidateAnswer("");

      if (result.data.done) {
        // Interview completed
        setIsInterviewCompleted(true);
        setInterviewerText(result.data.interviewerText);

        // Add final interviewer message to transcript
        setTranscript((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: result.data.interviewerText,
          },
        ]);
      } else {
        // More questions remain
        setCurrentQuestionIndex(result.data.questionIndex);
        setInterviewerText(result.data.interviewerText);

        // Add next interviewer question to transcript
        setTranscript((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: result.data.interviewerText,
          },
        ]);
      }

      setIsSubmittingAnswer(false);
    } catch (err) {
      console.error("Error submitting answer:", err);
      setInterviewError(err.message || "Failed to submit answer");
      setIsSubmittingAnswer(false);
    }
  };

  const handleKeyDown = (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !isSubmittingAnswer &&
      !isInterviewCompleted
    ) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div
          className={`px-8 py-6 text-center ${
            isExpired ? "bg-orange-500" : "bg-green-500"
          }`}
        >
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4">
            <CheckCircle
              className={`w-10 h-10 ${
                isExpired ? "text-orange-500" : "text-green-500"
              }`}
            />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">
            {isExpired
              ? "Assessment Submitted (Time Expired)"
              : "Assessment Submitted Successfully!"}
          </h1>
          <p className="text-white/90">
            {isExpired
              ? "Your submission was received after the time limit"
              : "Thank you for completing the assessment"}
          </p>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Assessment Info */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {assessment.title}
            </h2>
            <div className="space-y-2 text-sm text-gray-600">
              {submission.candidateName && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Candidate:</span>
                  <span>{submission.candidateName}</span>
                </div>
              )}
              {submission.candidateEmail && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Email:</span>
                  <span>{submission.candidateEmail}</span>
                </div>
              )}
            </div>
          </div>

          {/* Submission Details */}
          <div className="space-y-4 mb-6">
            {submission.githubLink && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-start gap-3">
                  <LinkIcon className="w-5 h-5 text-[#1E3A8A] flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">
                      GitHub Repository
                    </h3>
                    <a
                      href={submission.githubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1E3A8A] hover:underline text-sm break-all"
                    >
                      {submission.githubLink}
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {submission.timeSpent !== undefined && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500">Time Spent</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {submission.timeSpent} minutes
                  </p>
                </div>
              )}

              {submission.submittedAt && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500">Submitted At</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Status Message */}
          <div
            className={`p-4 rounded-xl mb-6 ${
              isExpired
                ? "bg-orange-50 border border-orange-200"
                : "bg-blue-50 border border-blue-200"
            }`}
          >
            <p
              className={`text-sm ${
                isExpired ? "text-orange-800" : "text-blue-800"
              }`}
            >
              {isExpired ? (
                <>
                  <strong>Note:</strong> Your submission was received after the
                  time limit had expired. The assessment team will review your
                  submission.
                </>
              ) : (
                <>
                  <strong>What's next?</strong> Your submission has been
                  received and will be reviewed by the assessment team. You will
                  be contacted with the results.
                </>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-4">
            {submission.githubLink && !sessionId && (
              <Button
                onClick={handleGenerateInterview}
                disabled={isGeneratingInterview}
                className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-6 text-lg rounded-xl disabled:opacity-50"
              >
                {isGeneratingInterview ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating Interview Questions...
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5 mr-2" />
                    Generate Interview Questions
                  </>
                )}
              </Button>
            )}

            {interviewError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                {interviewError}
              </div>
            )}

            {!sessionId && (
              <div className="text-center">
                <p className="text-sm text-gray-500">
                  You can close this page. Your submission has been saved.
                </p>
              </div>
            )}
          </div>

          {/* ElevenLabs Voice Interview Section */}
          {submission?._id && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 pt-8 border-t border-gray-200"
            >
              <ElevenLabsInterviewClient
                submissionId={submission._id}
                userId={submission.candidateEmail}
              />
            </motion.div>
          )}

          {/* Text-Based Interview Section */}
          {sessionId && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 pt-8 border-t border-gray-200"
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  Interview
                </h2>
                {currentQuestionIndex !== null && totalQuestions && (
                  <p className="text-sm text-gray-600">
                    Question {currentQuestionIndex + 1} of {totalQuestions}
                  </p>
                )}
                {isInterviewCompleted && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800 font-medium">
                    Interview Complete
                  </div>
                )}
              </div>

              {/* Interviewer Prompt */}
              {interviewerText && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Interviewer:
                  </h3>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <p className="text-gray-900 leading-relaxed">
                      {interviewerText}
                    </p>
                  </div>
                </div>
              )}

              {/* Candidate Answer Input */}
              {!isInterviewCompleted && (
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Your Answer:
                  </label>
                  <textarea
                    value={candidateAnswer}
                    onChange={(e) => setCandidateAnswer(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer here..."
                    disabled={isSubmittingAnswer || isInterviewCompleted}
                    className="w-full min-h-[120px] p-4 text-sm border border-gray-300 rounded-xl font-sans resize-y focus:outline-none focus:ring-2 focus:ring-[#1E3A8A] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Press Enter to submit (Shift+Enter for new line)
                    </p>
                    <Button
                      onClick={handleSubmitAnswer}
                      disabled={
                        isSubmittingAnswer ||
                        !candidateAnswer.trim() ||
                        isInterviewCompleted
                      }
                      className="bg-[#1E3A8A] hover:bg-[#152a66] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmittingAnswer ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        "Submit Answer"
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Transcript */}
              {transcript.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Transcript
                  </h3>
                  <div className="bg-gray-50 rounded-xl border border-gray-200 max-h-[400px] overflow-y-auto p-4">
                    <div className="space-y-4">
                      {transcript.map((entry, index) => (
                        <div
                          key={index}
                          className={`p-4 rounded-lg border-l-4 ${
                            entry.role === "interviewer"
                              ? "bg-blue-50 border-blue-500"
                              : "bg-white border-green-500"
                          }`}
                        >
                          <div
                            className={`text-sm font-semibold mb-2 ${
                              entry.role === "interviewer"
                                ? "text-blue-700"
                                : "text-green-700"
                            }`}
                          >
                            {entry.role === "interviewer"
                              ? "Interviewer"
                              : "Candidate"}
                            :
                          </div>
                          <p className="text-gray-900 whitespace-pre-wrap">
                            {entry.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
