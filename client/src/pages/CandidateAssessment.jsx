import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Clock,
  AlertCircle,
  Play,
  Link as LinkIcon,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getSubmissionByToken,
  startAssessment,
  submitAssessment,
  optOutAssessment,
} from "@/api/submission";
import { createPageUrl } from "@/utils";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function CandidateAssessment() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(null); // in minutes
  const [timeDisplay, setTimeDisplay] = useState(""); // formatted display
  const [showOptOutModal, setShowOptOutModal] = useState(false);
  const [optOutReason, setOptOutReason] = useState("");
  const [isOptingOut, setIsOptingOut] = useState(false);

  // Load submission on mount
  useEffect(() => {
    if (!token) {
      alert("No token provided in URL");
      setIsLoading(false);
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

          // If already submitted or expired, redirect to submitted page
          if (
            result.data.status === "submitted" ||
            result.data.status === "expired"
          ) {
            navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
            return;
          }

          // If opted out, stop here - don't redirect, just show the opted out screen
          // This prevents redirect loops and API spam
          if (result.data.status === "opted-out") {
            setIsLoading(false);
            return;
          }

          if (result.data.status === "in-progress") {
            setTimeRemaining(result.data.timeRemaining);
          }
          // Load existing github link if any
          if (result.data.githubLink) {
            setGithubUrl(result.data.githubLink);
          }
        } else {
          const errorMsg =
            "error" in result ? result.error : "Failed to load assessment";
          alert(errorMsg);
        }
      } catch (error) {
        console.error("Error loading submission:", error);
        alert("Failed to load assessment");
      } finally {
        setIsLoading(false);
      }
    };

    loadSubmission();
  }, [token]);

  // Sync time with backend every 30 seconds if assessment is in progress
  // IMPORTANT: Don't poll if opted out to prevent API spam
  useEffect(() => {
    if (
      !token ||
      !submission ||
      submission.status !== "in-progress" ||
      submission.status === "opted-out"
    ) {
      return;
    }

    const syncTime = async () => {
      try {
        const result = await getSubmissionByToken(token);
        if (result.success && result.data.timeRemaining !== null) {
          setTimeRemaining(result.data.timeRemaining);
        }
      } catch (error) {
        console.error("Error syncing time:", error);
      }
    };

    // Sync immediately
    syncTime();

    // Then sync every 30 seconds
    const interval = setInterval(syncTime, 30000);
    return () => clearInterval(interval);
  }, [token, submission]);

  // Update time display every second
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) {
      setTimeDisplay("00:00:00");
      return;
    }

    const updateDisplay = () => {
      const hours = Math.floor(timeRemaining / 60);
      const minutes = Math.floor(timeRemaining % 60);
      const seconds = Math.floor((timeRemaining % 1) * 60);
      setTimeDisplay(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
          2,
          "0"
        )}:${String(seconds).padStart(2, "0")}`
      );
    };

    updateDisplay();
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 0) return 0;
        return Math.max(0, prev - 1 / 60); // Decrease by 1 second (1/60 of a minute)
      });
      updateDisplay();
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining]);

  const handleStart = async () => {
    if (!token) {
      alert("No token provided");
      return;
    }

    setIsStarting(true);
    try {
      const result = await startAssessment(token);
      if (result.success) {
        setSubmission(result.data);
        setTimeRemaining(result.data.timeRemaining);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to start assessment";
        alert(errorMsg);
      }
    } catch (error) {
      console.error("Error starting assessment:", error);
      alert("Failed to start assessment");
    } finally {
      setIsStarting(false);
    }
  };

  const handleSubmit = async () => {
    if (!githubUrl.trim()) {
      alert("Please enter a GitHub repository URL");
      return;
    }

    if (!token) {
      alert("No token provided");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitAssessment(token, githubUrl.trim());
      if (result.success) {
        // Redirect to submitted page
        navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to submit assessment";
        alert(errorMsg);
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Error submitting assessment:", error);
      alert("Failed to submit assessment");
      setIsSubmitting(false);
    }
  };

  const handleOptOut = async () => {
    if (!token) {
      alert("No token provided");
      return;
    }

    setIsOptingOut(true);
    try {
      const result = await optOutAssessment(
        token,
        optOutReason.trim() || undefined
      );
      if (result.success) {
        // Update local state to show opted out screen
        setSubmission(result.data);
        setShowOptOutModal(false);
        setOptOutReason("");
      } else {
        const errorMsg = "error" in result ? result.error : "Failed to opt out";
        alert(errorMsg);
        setIsOptingOut(false);
      }
    } catch (error) {
      console.error("Error opting out:", error);
      alert("Failed to opt out");
      setIsOptingOut(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading assessment...</p>
        </div>
      </div>
    );
  }

  if (!submission || !assessment) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load assessment</p>
        </div>
      </div>
    );
  }

  // Show opted out screen if candidate has opted out
  if (submission.status === "opted-out") {
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

  const hasStarted =
    submission.status === "in-progress" ||
    submission.status === "submitted" ||
    submission.status === "expired";

  // Calculate time limit display
  const timeLimitHours = Math.floor(assessment.timeLimit / 60);
  const timeLimitMinutes = assessment.timeLimit % 60;
  const timeLimitDisplay =
    timeLimitHours > 0
      ? `${timeLimitHours} hour${timeLimitHours > 1 ? "s" : ""}${
          timeLimitMinutes > 0
            ? ` ${timeLimitMinutes} minute${timeLimitMinutes > 1 ? "s" : ""}`
            : ""
        }`
      : `${timeLimitMinutes} minute${timeLimitMinutes > 1 ? "s" : ""}`;

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#1E3A8A] px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4 overflow-hidden">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {assessment.title}
            </h1>
            <p className="text-blue-200">Technical Assessment</p>
            {assessment.userId?.companyName && (
              <p className="text-blue-300 text-sm mt-2">
                From {assessment.userId.companyName}
              </p>
            )}
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Time Info */}
            <div className="flex items-center justify-center gap-6 mb-8 py-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-5 h-5 text-[#1E3A8A]" />
                <span className="text-sm">
                  <strong>{timeLimitDisplay}</strong> to complete
                </span>
              </div>
            </div>

            {/* Starter Files GitHub Link (if available) */}
            {assessment.starterFilesGitHubLink && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <LinkIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-blue-900 mb-1">
                      Starter Files & Instructions
                    </h3>
                    <p className="text-sm text-blue-800 mb-2">
                      Access the starter files and detailed instructions:
                    </p>
                    <a
                      href={assessment.starterFilesGitHubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium break-all"
                    >
                      {assessment.starterFilesGitHubLink}
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-6">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <strong>Important:</strong> Once you start, the timer begins.
                You'll have {timeLimitDisplay} to complete and submit your work.
                Make sure you're ready before clicking Start.
              </div>
            </div>

            {/* Start Button */}
            <Button
              onClick={handleStart}
              disabled={isStarting}
              className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-6 text-lg rounded-xl disabled:opacity-50 mb-3"
            >
              <Play className="w-5 h-5 mr-2" />
              {isStarting ? "Starting..." : "Start Assessment"}
            </Button>

            {/* Opt Out Button */}
            <button
              onClick={() => setShowOptOutModal(true)}
              className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
            >
              I cannot complete this assessment
            </button>
          </div>
        </motion.div>

        {/* Opt Out Modal - Available in both states */}
        {showOptOutModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            >
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Opt Out of Assessment
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to opt out of this assessment? Please let
                us know why (optional):
              </p>
              <Textarea
                value={optOutReason}
                onChange={(e) => setOptOutReason(e.target.value)}
                placeholder="E.g., Time constraints, technical issues, not interested..."
                className="min-h-[100px] mb-4"
              />
              <div className="flex gap-3">
                <Button
                  onClick={handleOptOut}
                  disabled={isOptingOut}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {isOptingOut ? "Opting Out..." : "Confirm Opt Out"}
                </Button>
                <Button
                  onClick={() => {
                    setShowOptOutModal(false);
                    setOptOutReason("");
                  }}
                  variant="outline"
                  disabled={isOptingOut}
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  // Started state - show submission form
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                {assessment.title}
              </h1>
              {assessment.userId?.companyName && (
                <p className="text-xs text-gray-500">
                  {assessment.userId.companyName}
                </p>
              )}
            </div>
          </div>
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              timeRemaining !== null && timeRemaining <= 15
                ? "bg-red-50 text-red-700"
                : timeRemaining !== null && timeRemaining <= 60
                ? "bg-yellow-50 text-yellow-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="font-mono font-semibold">
              {timeRemaining !== null ? timeDisplay : "00:00:00"}
            </span>
            <span className="text-sm">remaining</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Project Instructions
            </h2>
            <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-3">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold text-gray-900 mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className="mb-3">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside mb-3 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside mb-3 space-y-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="ml-2">{children}</li>,
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
                        {children}
                      </code>
                    ) : (
                      <code className="block bg-gray-100 text-gray-800 p-3 rounded text-sm font-mono overflow-x-auto mb-3">
                        {children}
                      </code>
                    );
                  },
                  strong: ({ children }) => (
                    <strong className="font-semibold text-gray-900">
                      {children}
                    </strong>
                  ),
                }}
              >
                {assessment.description}
              </ReactMarkdown>
            </div>

            {/* Starter Files GitHub Link */}
            {assessment.starterFilesGitHubLink && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <LinkIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-blue-900 mb-1">
                      Starter Files & Instructions
                    </h3>
                    <p className="text-sm text-blue-800 mb-2">
                      Access the starter files and detailed instructions in the
                      GitHub repository:
                    </p>
                    <a
                      href={assessment.starterFilesGitHubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium break-all"
                    >
                      {assessment.starterFilesGitHubLink}
                    </a>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Submission Form */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl border border-gray-200 p-6"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Submit Your Work
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  GitHub Repository URL *
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/username/repository"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Please include any additional context,
                  notes about your approach, trade-offs made, or things you'd
                  improve with more time in your repository's README file.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !githubUrl ||
                    isSubmitting ||
                    (timeRemaining !== null && timeRemaining <= 0)
                  }
                  className="flex-1 bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5 disabled:opacity-50"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmitting ? "Submitting..." : "Submit Assessment"}
                </Button>
                <Button
                  onClick={() => setShowOptOutModal(true)}
                  variant="outline"
                  className="px-4 py-5 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  <X className="w-4 h-4 mr-2" />
                  Opt Out
                </Button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Need Help Section - Bottom */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 bg-blue-50 rounded-xl border border-blue-100 p-5 text-center"
        >
          <h3 className="font-medium text-[#1E3A8A] mb-2">Need Help?</h3>
          <p className="text-sm text-gray-600">
            If you encounter any technical issues, contact support@bridge.ai
          </p>
        </motion.div>
      </div>

      {/* Opt Out Modal - Available in both states */}
      {showOptOutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Opt Out of Assessment
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to opt out of this assessment? Please let us
              know why (optional):
            </p>
            <Textarea
              value={optOutReason}
              onChange={(e) => setOptOutReason(e.target.value)}
              placeholder="E.g., Time constraints, technical issues, not interested..."
              className="min-h-[100px] mb-4"
            />
            <div className="flex gap-3">
              <Button
                onClick={handleOptOut}
                disabled={isOptingOut}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isOptingOut ? "Opting Out..." : "Confirm Opt Out"}
              </Button>
              <Button
                onClick={() => {
                  setShowOptOutModal(false);
                  setOptOutReason("");
                }}
                variant="outline"
                disabled={isOptingOut}
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
