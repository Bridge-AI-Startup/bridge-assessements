import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Clock,
  FileText,
  Code,
  Calendar,
  AlertCircle,
  Play,
  Upload,
  Link as LinkIcon,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getSubmissionByToken,
  startAssessment,
  submitAssessment,
} from "@/api/submission";

export default function CandidateAssessment() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(null); // in minutes
  const [timeDisplay, setTimeDisplay] = useState(""); // formatted display

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
  useEffect(() => {
    if (!token || !submission || submission.status !== "in-progress") {
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
        alert("Assessment submitted successfully!");
        setSubmission(result.data);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to submit assessment";
        alert(errorMsg);
      }
    } catch (error) {
      console.error("Error submitting assessment:", error);
      alert("Failed to submit assessment");
    } finally {
      setIsSubmitting(false);
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
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4">
              <span className="text-[#1E3A8A] font-bold text-2xl">B</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {assessment.title}
            </h1>
            <p className="text-blue-200">Technical Assessment</p>
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
              className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-6 text-lg rounded-xl disabled:opacity-50"
            >
              <Play className="w-5 h-5 mr-2" />
              {isStarting ? "Starting..." : "Start Assessment"}
            </Button>
          </div>
        </motion.div>
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
            <div className="w-10 h-10 rounded-xl bg-[#1E3A8A] flex items-center justify-center">
              <span className="text-white font-bold">
                {assessment.companyLogo}
              </span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                {assessment.title}
              </h1>
              <p className="text-xs text-gray-500">{assessment.companyName}</p>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Notes (optional)
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional context about your approach, trade-offs made, or things you'd improve with more time..."
                  className="min-h-[100px]"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={
                  !githubUrl ||
                  isSubmitting ||
                  (timeRemaining !== null && timeRemaining <= 0)
                }
                className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5 disabled:opacity-50"
              >
                <Send className="w-4 h-4 mr-2" />
                {isSubmitting ? "Submitting..." : "Submit Assessment"}
              </Button>
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
    </div>
  );
}
