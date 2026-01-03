import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  CheckCircle,
  Clock,
  TrendingDown,
  Search,
  Filter,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  MessageSquare,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  getSubmissionsForAssessment,
  deleteSubmission,
} from "@/api/submission";
import { getAssessment } from "@/api/assessment";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";

export default function SubmissionsDashboard() {
  const [searchParams] = useSearchParams();
  const assessmentId = searchParams.get("assessmentId");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [submissions, setSubmissions] = useState([]);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [isDropoffAnalysisExpanded, setIsDropoffAnalysisExpanded] =
    useState(false);
  const { toast } = useToast();

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        window.location.href = "/";
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch assessment and submissions
  useEffect(() => {
    if (!assessmentId || !currentUser) {
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch assessment details
        const token = await currentUser.getIdToken();
        const assessmentResult = await getAssessment(assessmentId, token);

        if (!assessmentResult.success) {
          setError("Failed to load assessment");
          setIsLoading(false);
          return;
        }

        setAssessment(assessmentResult.data);

        // Fetch submissions
        const submissionsResult = await getSubmissionsForAssessment(
          assessmentId,
          token
        );

        if (submissionsResult.success) {
          setSubmissions(submissionsResult.data || []);
        } else {
          setError(submissionsResult.error || "Failed to load submissions");
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        setError(err.message || "An unexpected error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [assessmentId, currentUser]);

  // Calculate stats from real data
  const stats = React.useMemo(() => {
    const totalInvited = submissions.length;

    // Started includes: in-progress, submitted, expired, and opted-out (if they started)
    const started = submissions.filter(
      (s) =>
        s.status === "in-progress" ||
        s.status === "submitted" ||
        s.status === "expired" ||
        (s.status === "opted-out" && s.startedAt)
    ).length;

    // Completed only includes submitted (not expired)
    const completed = submissions.filter(
      (s) => s.status === "submitted"
    ).length;

    const expired = submissions.filter((s) => s.status === "expired").length;
    const optedOut = submissions.filter((s) => s.status === "opted-out").length;

    // Calculate average time spent (in minutes) - only for completed submissions
    const completedSubmissions = submissions.filter(
      (s) => s.status === "submitted" && s.timeSpent && s.timeSpent > 0
    );
    const avgTimeSpentMinutes =
      completedSubmissions.length > 0
        ? Math.round(
            completedSubmissions.reduce(
              (sum, s) => sum + (s.timeSpent || 0),
              0
            ) / completedSubmissions.length
          )
        : 0;

    const formatTime = (minutes) => {
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    return {
      totalInvited,
      started,
      completed,
      expired,
      optedOut,
      avgTimeSpent: formatTime(avgTimeSpentMinutes),
    };
  }, [submissions]);

  const dropoffRate =
    stats.started > 0
      ? Math.round(((stats.started - stats.completed) / stats.started) * 100)
      : 0;
  const startRate =
    stats.totalInvited > 0
      ? Math.round((stats.started / stats.totalInvited) * 100)
      : 0;
  const completionRate =
    stats.started > 0 ? Math.round((stats.completed / stats.started) * 100) : 0;

  // Analyze dropoff feedback
  const dropoffAnalysis = React.useMemo(() => {
    const optedOutSubmissions = submissions.filter(
      (s) => s.status === "opted-out" && s.optOutReason
    );

    if (optedOutSubmissions.length === 0) {
      return null;
    }

    const reasons = optedOutSubmissions.map((s) =>
      s.optOutReason.toLowerCase().trim()
    );

    // Common themes/categories
    const themes = {
      time: {
        keywords: [
          "time",
          "busy",
          "schedule",
          "deadline",
          "hours",
          "long",
          "too much time",
          "not enough time",
        ],
        count: 0,
        examples: [],
      },
      complexity: {
        keywords: [
          "too hard",
          "too difficult",
          "complex",
          "challenging",
          "overwhelming",
          "advanced",
        ],
        count: 0,
        examples: [],
      },
      unclear: {
        keywords: [
          "unclear",
          "confusing",
          "unclear instructions",
          "not clear",
          "vague",
          "ambiguous",
        ],
        count: 0,
        examples: [],
      },
      notInterested: {
        keywords: [
          "not interested",
          "not a fit",
          "not right",
          "different",
          "not for me",
        ],
        count: 0,
        examples: [],
      },
      technical: {
        keywords: [
          "technical",
          "tech stack",
          "framework",
          "language",
          "tools",
          "environment",
        ],
        count: 0,
        examples: [],
      },
      other: {
        keywords: [],
        count: 0,
        examples: [],
      },
    };

    // Categorize reasons
    reasons.forEach((reason, index) => {
      let categorized = false;
      const originalReason = optedOutSubmissions[index].optOutReason;

      for (const [themeName, theme] of Object.entries(themes)) {
        if (themeName === "other") continue;

        if (theme.keywords.some((keyword) => reason.includes(keyword))) {
          theme.count++;
          if (theme.examples.length < 3) {
            theme.examples.push(originalReason);
          }
          categorized = true;
          break;
        }
      }

      if (!categorized) {
        themes.other.count++;
        if (themes.other.examples.length < 3) {
          themes.other.examples.push(originalReason);
        }
      }
    });

    // Generate suggestions based on themes
    const suggestions = [];

    if (themes.time.count > 0) {
      suggestions.push({
        priority: themes.time.count >= 2 ? "high" : "medium",
        issue: "Time concerns",
        suggestion:
          "Consider reducing the time limit or breaking the assessment into smaller parts. Make the expected time commitment clear upfront.",
        count: themes.time.count,
      });
    }

    if (themes.complexity.count > 0) {
      suggestions.push({
        priority: themes.complexity.count >= 2 ? "high" : "medium",
        issue: "Assessment too complex",
        suggestion:
          "Review the difficulty level. Consider providing starter code or scaffolding to help candidates get started faster.",
        count: themes.complexity.count,
      });
    }

    if (themes.unclear.count > 0) {
      suggestions.push({
        priority: "high",
        issue: "Unclear instructions",
        suggestion:
          "Clarify the project description and requirements. Add more specific examples and expected deliverables.",
        count: themes.unclear.count,
      });
    }

    if (themes.technical.count > 0) {
      suggestions.push({
        priority: "medium",
        issue: "Technical stack mismatch",
        suggestion:
          "Ensure the required technologies are clearly stated in the job description and assessment. Consider offering flexibility in tech stack.",
        count: themes.technical.count,
      });
    }

    if (themes.notInterested.count > 0) {
      suggestions.push({
        priority: "low",
        issue: "Not a good fit",
        suggestion:
          "This is expected - some candidates will self-select out. Ensure your job description accurately represents the role.",
        count: themes.notInterested.count,
      });
    }

    // Sort suggestions by priority and count
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.count - a.count;
    });

    return {
      totalWithFeedback: optedOutSubmissions.length,
      themes,
      suggestions,
      allReasons: optedOutSubmissions.map((s) => s.optOutReason),
    };
  }, [submissions]);

  const filteredSubmissions = submissions.filter((sub) => {
    const name = sub.candidateName || "";
    const email = sub.candidateEmail || "";
    const matchesSearch =
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.toLowerCase().includes(searchQuery.toLowerCase());
    // Map filter values to actual status values
    let filterStatus = statusFilter;
    if (statusFilter === "completed") filterStatus = "submitted";
    if (statusFilter === "not_started") filterStatus = "pending";
    if (statusFilter === "in_progress") filterStatus = "in-progress";
    if (statusFilter === "opted_out") filterStatus = "opted-out";
    const matchesStatus = statusFilter === "all" || sub.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const formatTimeSpent = (minutes) => {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getStatusBadge = (status, submission) => {
    const styles = {
      submitted: "bg-green-100 text-green-700",
      "in-progress": "bg-blue-100 text-blue-700",
      pending: "bg-gray-100 text-gray-600",
      expired: "bg-red-100 text-red-700",
      "opted-out": "bg-orange-100 text-orange-700",
    };
    const labels = {
      submitted: "Completed",
      "in-progress": "In Progress",
      pending: "Not Started",
      expired: "Expired",
      "opted-out": submission?.startedAt
        ? "Opted Out (After Start)"
        : "Opted Out (Before Start)",
    };
    return (
      <Badge className={styles[status] || "bg-gray-100 text-gray-600"}>
        {labels[status] || status}
      </Badge>
    );
  };

  const getInterviewStatusBadge = (interview) => {
    if (!interview) {
      return <Badge className="bg-gray-100 text-gray-600">Not Started</Badge>;
    }

    const statusStyles = {
      not_started: "bg-gray-100 text-gray-600",
      in_progress: "bg-blue-100 text-blue-700",
      completed: "bg-green-100 text-green-700",
      failed: "bg-red-100 text-red-700",
    };

    const statusLabels = {
      not_started: "Not Started",
      in_progress: "In Progress",
      completed: "Completed",
      failed: "Failed",
    };

    return (
      <Badge
        className={statusStyles[interview.status] || statusStyles.not_started}
      >
        {statusLabels[interview.status] || "Unknown"}
      </Badge>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleViewInterview = (submission) => {
    setSelectedInterview(submission);
    setShowInterviewModal(true);
  };

  const [submissionToDelete, setSubmissionToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (submission) => {
    setSubmissionToDelete(submission);
  };

  const handleDeleteConfirm = async () => {
    if (!submissionToDelete || !currentUser) return;

    setIsDeleting(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await deleteSubmission(submissionToDelete._id, token);

      if (result.success) {
        // Remove the submission from the list
        setSubmissions((prev) =>
          prev.filter((s) => s._id !== submissionToDelete._id)
        );
        setSubmissionToDelete(null);
      } else {
        setError(result.error || "Failed to delete submission");
      }
    } catch (err) {
      console.error("Error deleting submission:", err);
      setError(err.message || "An error occurred while deleting");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setSubmissionToDelete(null);
  };

  const getCandidateLink = (submission) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}${createPageUrl("CandidateAssessment")}?token=${
      submission.token
    }`;
  };

  const handleCopyLink = async (submission) => {
    const link = getCandidateLink(submission);
    try {
      await navigator.clipboard.writeText(link);
      toast({
        title: "Link copied",
        description: "You have copied submission link",
      });
    } catch (error) {
      console.error("Failed to copy link:", error);
      toast({
        title: "Failed to copy",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Link
            to={createPageUrl("Home")}
            className="text-sm text-gray-500 hover:text-[#1E3A8A] mb-1 block"
          >
            ← Back to Assessments
          </Link>
          <h1 className="text-2xl font-bold text-[#1E3A8A]">
            {assessment ? assessment.title : "Submissions Dashboard"}
          </h1>
          <p className="text-gray-500 text-sm">
            {assessment
              ? `Track candidate progress and review submissions for "${assessment.title}"`
              : "Track candidate progress and review submissions"}
          </p>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-4 gap-4 mb-8"
        >
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {stats.totalInvited}
            </p>
            <p className="text-sm text-gray-500">Total Invited</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-blue-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {startRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.started}</p>
            <p className="text-sm text-gray-500">Started</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {completionRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {stats.completed}
            </p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="w-5 h-5 text-red-500" />
              <span className="text-xs text-red-600 flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" />
                {dropoffRate}%
              </span>
            </div>
            <p className="text-2xl font-bold text-red-600">
              {stats.started - stats.completed}
            </p>
            <p className="text-sm text-gray-500">Dropoff</p>
          </div>
        </motion.div>

        {/* Dropoff Feedback Analysis */}
        {dropoffAnalysis && dropoffAnalysis.totalWithFeedback > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl border border-orange-200 mb-6 overflow-hidden"
          >
            <button
              onClick={() =>
                setIsDropoffAnalysisExpanded(!isDropoffAnalysisExpanded)
              }
              className="w-full p-6 flex items-center justify-between hover:bg-orange-100/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <TrendingDown className="w-6 h-6 text-orange-600" />
                <h2 className="text-xl font-semibold text-gray-900">
                  Dropoff Feedback Analysis
                </h2>
                <Badge className="bg-orange-100 text-orange-700">
                  {dropoffAnalysis.totalWithFeedback} feedback
                  {dropoffAnalysis.totalWithFeedback !== 1 ? "s" : ""}
                </Badge>
              </div>
              {isDropoffAnalysisExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-600" />
              )}
            </button>

            {isDropoffAnalysisExpanded && (
              <div className="px-6 pb-6">
                {/* Suggestions */}
                {dropoffAnalysis.suggestions.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Recommendations
                    </h3>
                    <div className="space-y-3">
                      {dropoffAnalysis.suggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className={`p-4 rounded-lg border-l-4 ${
                            suggestion.priority === "high"
                              ? "bg-red-50 border-red-500"
                              : suggestion.priority === "medium"
                              ? "bg-yellow-50 border-yellow-500"
                              : "bg-blue-50 border-blue-500"
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-gray-900">
                                  {suggestion.issue}
                                </span>
                                <Badge
                                  className={
                                    suggestion.priority === "high"
                                      ? "bg-red-100 text-red-700"
                                      : suggestion.priority === "medium"
                                      ? "bg-yellow-100 text-yellow-700"
                                      : "bg-blue-100 text-blue-700"
                                  }
                                >
                                  {suggestion.priority} priority
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  ({suggestion.count} mention
                                  {suggestion.count !== 1 ? "s" : ""})
                                </span>
                              </div>
                              <p className="text-sm text-gray-700">
                                {suggestion.suggestion}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Common Themes */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Common Themes
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(dropoffAnalysis.themes)
                      .filter(([_, theme]) => theme.count > 0)
                      .map(([themeName, theme]) => (
                        <div
                          key={themeName}
                          className="bg-white rounded-lg border border-orange-200 p-3"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-900 capitalize">
                              {themeName === "notInterested"
                                ? "Not Interested"
                                : themeName}
                            </span>
                            <Badge className="bg-orange-100 text-orange-700">
                              {theme.count}
                            </Badge>
                          </div>
                          {theme.examples.length > 0 && (
                            <div className="space-y-1">
                              {theme.examples
                                .slice(0, 2)
                                .map((example, idx) => (
                                  <p
                                    key={idx}
                                    className="text-xs text-gray-600 italic truncate"
                                    title={example}
                                  >
                                    "{example}"
                                  </p>
                                ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-4"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="not_started">Not Started</option>
              <option value="opted_out">Opted Out</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </motion.div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500">Loading submissions...</p>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No submissions yet
            </h3>
            <p className="text-gray-500">
              {submissions.length === 0
                ? "No candidates have been invited to this assessment yet."
                : "No submissions match your search criteria."}
            </p>
          </div>
        ) : (
          /* Submissions Table */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Candidate
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Interview
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time Spent
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSubmissions.map((submission) => {
                  const candidateName = submission.candidateName || "Unknown";
                  const candidateEmail = submission.candidateEmail || "";
                  const initials = candidateName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <tr
                      key={submission._id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#1E3A8A] flex items-center justify-center text-white text-sm font-medium">
                            {initials}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {candidateName}
                            </p>
                            {candidateEmail && (
                              <p className="text-xs text-gray-500">
                                {candidateEmail}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(submission.status, submission)}
                          {submission.optedOut && submission.optOutReason && (
                            <p
                              className="text-xs text-gray-500 italic max-w-xs truncate"
                              title={submission.optOutReason}
                            >
                              "{submission.optOutReason}"
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {getInterviewStatusBadge(submission.interview)}
                          {submission.interview && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewInterview(submission)}
                              className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10 h-7 px-2"
                            >
                              <MessageSquare className="w-3.5 h-3.5 mr-1" />
                              Details
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatTimeSpent(submission.timeSpent)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Copy Link */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyLink(submission)}
                            className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
                            title="Copy candidate assessment link"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          {/* GitHub Link (if submitted) */}
                          {submission.status === "submitted" &&
                            submission.githubLink && (
                              <a
                                href={submission.githubLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
                                  title="View GitHub repository"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </a>
                            )}
                          {/* Delete */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(submission)}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            title="Delete submission"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}

        {/* Delete Confirmation Modal */}
        <Dialog
          open={!!submissionToDelete}
          onOpenChange={(open) => {
            if (!open) handleDeleteCancel();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Candidate Submission</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the submission from{" "}
                <strong>
                  {submissionToDelete?.candidateName || "this candidate"}
                </strong>
                ? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 mt-4">
              <Button
                variant="outline"
                onClick={handleDeleteCancel}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Interview Details Modal */}
        <Dialog open={showInterviewModal} onOpenChange={setShowInterviewModal}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Interview Details
                {selectedInterview && (
                  <span className="text-sm font-normal text-gray-500">
                    - {selectedInterview.candidateName || "Unknown Candidate"}
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>
                View transcript, summary, and metadata for this interview
              </DialogDescription>
            </DialogHeader>

            {selectedInterview?.interview ? (
              <div className="space-y-6 mt-4">
                {/* Opt-Out Information */}
                {selectedInterview.optedOut && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-orange-900 mb-2">
                      Candidate Opted Out
                    </p>
                    {selectedInterview.startedAt ? (
                      <p className="text-xs text-orange-800 mb-2 font-semibold">
                        ⚠️ Opted out after starting the assessment
                      </p>
                    ) : (
                      <p className="text-xs text-orange-800 mb-2 font-semibold">
                        ℹ️ Opted out before starting the assessment
                      </p>
                    )}
                    {selectedInterview.optOutReason && (
                      <p className="text-sm text-orange-800 mb-1">
                        <strong>Reason:</strong>{" "}
                        {selectedInterview.optOutReason}
                      </p>
                    )}
                    {selectedInterview.optedOutAt && (
                      <p className="text-xs text-orange-700">
                        Opted out on: {formatDate(selectedInterview.optedOutAt)}
                      </p>
                    )}
                  </div>
                )}

                {/* Interview Status & Metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Status
                    </p>
                    {getInterviewStatusBadge(selectedInterview.interview)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Provider
                    </p>
                    <p className="text-sm text-gray-600 capitalize">
                      {selectedInterview.interview.provider || "—"}
                    </p>
                  </div>
                  {selectedInterview.interview.startedAt && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        Started At
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(selectedInterview.interview.startedAt)}
                      </p>
                    </div>
                  )}
                  {selectedInterview.interview.completedAt && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        Completed At
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(selectedInterview.interview.completedAt)}
                      </p>
                    </div>
                  )}
                  {selectedInterview.interview.conversationId && (
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        Conversation ID
                      </p>
                      <p className="text-sm text-gray-600 font-mono">
                        {selectedInterview.interview.conversationId}
                      </p>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {selectedInterview.interview.summary && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Summary
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {selectedInterview.interview.summary}
                      </p>
                    </div>
                  </div>
                )}

                {/* Transcript */}
                {selectedInterview.interview.transcript?.turns &&
                  selectedInterview.interview.transcript.turns.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        Transcript (
                        {selectedInterview.interview.transcript.turns.length}{" "}
                        turns)
                      </p>
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4 max-h-96 overflow-y-auto">
                        {selectedInterview.interview.transcript.turns.map(
                          (turn, index) => (
                            <div
                              key={index}
                              className={`flex gap-3 ${
                                turn.role === "agent"
                                  ? "justify-start"
                                  : "justify-end"
                              }`}
                            >
                              <div
                                className={`max-w-[80%] rounded-lg p-3 ${
                                  turn.role === "agent"
                                    ? "bg-white border border-gray-200"
                                    : "bg-[#1E3A8A] text-white"
                                }`}
                              >
                                <p className="text-xs font-medium mb-1 opacity-70">
                                  {turn.role === "agent"
                                    ? "Interviewer"
                                    : "Candidate"}
                                </p>
                                <p
                                  className={`text-sm ${
                                    turn.role === "agent"
                                      ? "text-gray-700"
                                      : "text-white"
                                  }`}
                                >
                                  {turn.text}
                                </p>
                                {(turn.startMs !== undefined ||
                                  turn.endMs !== undefined) && (
                                  <p className="text-xs opacity-60 mt-1">
                                    {turn.startMs !== undefined &&
                                      `${(turn.startMs / 1000).toFixed(1)}s`}
                                    {turn.startMs !== undefined &&
                                      turn.endMs !== undefined &&
                                      " - "}
                                    {turn.endMs !== undefined &&
                                      `${(turn.endMs / 1000).toFixed(1)}s`}
                                  </p>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {/* Error Information */}
                {selectedInterview.interview.error &&
                  selectedInterview.interview.error.message && (
                    <div>
                      <p className="text-sm font-medium text-red-700 mb-2">
                        Error
                      </p>
                      <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                        <p className="text-sm text-red-700">
                          {selectedInterview.interview.error.message}
                        </p>
                        {selectedInterview.interview.error.at && (
                          <p className="text-xs text-red-600 mt-1">
                            At:{" "}
                            {formatDate(selectedInterview.interview.error.at)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                {!selectedInterview.interview.summary &&
                  (!selectedInterview.interview.transcript?.turns ||
                    selectedInterview.interview.transcript.turns.length ===
                      0) && (
                    <div className="text-center py-8 text-gray-500">
                      <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No interview data available yet</p>
                    </div>
                  )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No interview data available</p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
