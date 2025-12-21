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
} from "@/api/submission";
import { createPageUrl } from "@/utils";

export default function CandidateSubmitted() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingInterview, setIsGeneratingInterview] = useState(false);
  const [interviewQuestions, setInterviewQuestions] = useState(null);
  const [interviewError, setInterviewError] = useState(null);

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
    if (!token) return;

    setIsGeneratingInterview(true);
    setInterviewError(null);
    setInterviewQuestions(null);

    try {
      const result = await generateInterviewQuestionsByToken(token);

      if (result.success) {
        setInterviewQuestions({
          questions: result.data.questions,
          candidateName: result.data.candidateName,
        });
      } else {
        setInterviewError(
          result.error || "Failed to generate interview questions"
        );
      }
    } catch (err) {
      console.error("Error generating interview:", err);
      setInterviewError(err.message || "An unexpected error occurred");
    } finally {
      setIsGeneratingInterview(false);
    }
  };

  const closeInterviewModal = () => {
    setInterviewQuestions(null);
    setInterviewError(null);
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
            {submission.githubLink && (
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

            <div className="text-center">
              <p className="text-sm text-gray-500">
                You can close this page. Your submission has been saved.
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Interview Questions Modal */}
      {interviewQuestions && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6"
          onClick={closeInterviewModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Interview Questions
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Questions based on your code submission
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeInterviewModal}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </Button>
            </div>

            {/* Questions */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-4">
                {interviewQuestions.questions.map((question, index) => (
                  <div
                    key={index}
                    className="bg-gray-50 rounded-lg p-4 border border-gray-200"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#1E3A8A] text-white flex items-center justify-center text-sm font-medium flex-shrink-0">
                        {index + 1}
                      </div>
                      <p className="text-gray-900 leading-relaxed">
                        {question}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <Button
                onClick={closeInterviewModal}
                className="bg-[#1E3A8A] hover:bg-[#152a66] text-white"
              >
                Close
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
