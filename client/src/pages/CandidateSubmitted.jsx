import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Link as LinkIcon,
  Clock,
  Calendar,
  Loader2,
  X,
} from "lucide-react";
import { getSubmissionByToken } from "@/api/submission";
import { createPageUrl } from "@/utils";
import ElevenLabsInterviewClient from "@/components/ElevenLabsInterviewClient";

export default function CandidateSubmitted() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWaitingForQuestions, setIsWaitingForQuestions] = useState(false);
  const [interviewError, setInterviewError] = useState(null);
  const [isInterviewCompletedLocally, setIsInterviewCompletedLocally] =
    useState(false);

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

          // If interview is already completed, set local state immediately
          if (result.data.interview?.status === "completed") {
            setIsInterviewCompletedLocally(true);
          }

          // If submission is opted out, show opted out screen (don't redirect to avoid loops)
          if (result.data.status === "opted-out") {
            // Keep the submission data but we'll show opted out UI below
            setIsLoading(false);
            return;
          }

          // If submission is not submitted, redirect back to assessment
          if (
            result.data.status !== "submitted" &&
            result.data.status !== "expired"
          ) {
            navigate(`${createPageUrl("CandidateAssessment")}?token=${token}`);
            return;
          }

          // Check if interview questions exist
          // Only check/poll for questions if smart interviewer is enabled
          const isSmartInterviewerEnabled = 
            typeof assessmentData === "object" && 
            assessmentData !== null && 
            assessmentData.isSmartInterviewerEnabled !== false;
          
          if (
            result.data.interviewQuestions &&
            Array.isArray(result.data.interviewQuestions) &&
            result.data.interviewQuestions.length > 0
          ) {
            // Questions are ready, ElevenLabs component will be shown
            setIsWaitingForQuestions(false);
          } else if (result.data.githubLink && isSmartInterviewerEnabled) {
            // Questions not ready yet, start polling (only if smart interviewer is enabled)
            setIsWaitingForQuestions(true);
            pollForQuestions();
          } else {
            // Smart interviewer is disabled or no github link, don't wait for questions
            setIsWaitingForQuestions(false);
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

  // Poll for interview questions until they're ready
  const pollForQuestions = async () => {
    const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10s)
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setIsWaitingForQuestions(false);
        setInterviewError(
          "Interview questions are taking longer than expected. Please refresh the page."
        );
        return;
      }

      try {
        const result = await getSubmissionByToken(token);
        if (
          result.success &&
          result.data.interviewQuestions &&
          Array.isArray(result.data.interviewQuestions) &&
          result.data.interviewQuestions.length > 0
        ) {
          // Questions are ready!
          setSubmission(result.data);
          setIsWaitingForQuestions(false);
        } else {
          // Questions not ready yet, poll again in 10 seconds
          attempts++;
          setTimeout(poll, 10000);
        }
      } catch (error) {
        console.error("Error polling for questions:", error);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000);
        } else {
          setIsWaitingForQuestions(false);
          setInterviewError("Failed to check for interview questions.");
        }
      }
    };

    // Start polling after 10 seconds (give indexing time to start)
    setTimeout(poll, 10000);
  };

  // Poll for interview completion when interview ends
  const pollForInterviewCompletion = async () => {
    // Immediately mark as completed locally for instant UI update
    setIsInterviewCompletedLocally(true);

    const maxAttempts = 20; // Poll for up to 2 minutes (20 * 6s)
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        // Stop polling after max attempts, user can refresh manually
        return;
      }

      try {
        const result = await getSubmissionByToken(token);
        if (result.success && result.data) {
          // Check if interview status has changed to completed
          if (result.data.interview?.status === "completed") {
            setSubmission(result.data);
            return; // Stop polling once we see completed status
          }
        }

        // Poll again in 6 seconds
        attempts++;
        setTimeout(poll, 6000);
      } catch (error) {
        console.error("Error polling for interview completion:", error);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 6000);
        }
      }
    };

    // Start polling immediately
    poll();
  };

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
  const isOptedOut = submission.status === "opted-out";

  // Show opted out screen
  if (isOptedOut) {
    const optedOutBeforeStarting = !submission.startedAt;

    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-orange-500 px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4">
              <X className="w-10 h-10 text-orange-500" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              You Have Opted Out
            </h1>
            <p className="text-white/90">
              {optedOutBeforeStarting
                ? "You have chosen not to start this assessment"
                : "You have chosen not to complete this assessment"}
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                {assessment.title}
              </h2>
              {optedOutBeforeStarting ? (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-blue-800 font-medium">
                    ℹ️ You opted out before starting the assessment
                  </p>
                </div>
              ) : (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-orange-800 font-medium">
                    ⚠️ You opted out after starting the assessment
                  </p>
                </div>
              )}
              {submission.optOutReason && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Your reason:
                  </p>
                  <p className="text-sm text-gray-600">
                    {submission.optOutReason}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <p className="text-sm text-orange-800">
                <strong>Note:</strong>{" "}
                {optedOutBeforeStarting
                  ? "You opted out before starting the assessment. If you change your mind, please contact the assessment team."
                  : "You opted out after starting the assessment. If you change your mind, please contact the assessment team."}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

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
            {isWaitingForQuestions && assessment?.isSmartInterviewerEnabled !== false && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      Generating Interview Questions...
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      This may take a few moments. The interview will start
                      automatically when ready.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {interviewError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                {interviewError}
              </div>
            )}

            {!isWaitingForQuestions &&
              (!submission.interviewQuestions ||
                !Array.isArray(submission.interviewQuestions) ||
                submission.interviewQuestions.length === 0) && (
                <div className="text-center">
                  <p className="text-sm text-gray-500">
                    You can close this page. Your submission has been saved.
                  </p>
                </div>
              )}
          </div>

          {/* ElevenLabs Voice Interview Section - Only show when questions are ready and smart interviewer is enabled */}
          {submission?._id &&
            assessment?.isSmartInterviewerEnabled !== false &&
            submission.interviewQuestions &&
            Array.isArray(submission.interviewQuestions) &&
            submission.interviewQuestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 pt-8 border-t border-gray-200"
              >
                {/* Show completed interview view immediately if locally completed or backend says completed */}
                {isInterviewCompletedLocally ||
                submission.interview?.status === "completed" ? (
                  <div className="p-6 bg-green-50 border border-green-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-8 h-8 text-green-600" />
                      <div>
                        <h3 className="text-lg font-semibold text-green-900">
                          Interview Completed
                        </h3>
                        <p className="text-sm text-green-700 mt-1">
                          Thank you for completing the interview! Your responses
                          have been recorded.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ElevenLabsInterviewClient
                    submissionId={submission._id}
                    token={token}
                    userId={submission.candidateEmail}
                    interviewStatus={submission.interview?.status}
                    onInterviewStatusChange={async (newStatus) => {
                      // When interview completes, immediately show completed view and poll for updated submission data
                      if (newStatus === "completed") {
                        pollForInterviewCompletion();
                      }
                    }}
                  />
                )}
              </motion.div>
            )}
        </div>
      </motion.div>
    </div>
  );
}
