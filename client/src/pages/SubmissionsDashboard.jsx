import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  CheckCircle,
  Clock,
  TrendingDown,
  Search,
  Filter,
  ChevronDown,
  Eye,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  getSubmissionsForAssessment,
  generateInterviewQuestions,
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
  const [generatingInterview, setGeneratingInterview] = useState(null); // submissionId
  const [interviewQuestions, setInterviewQuestions] = useState(null); // { submissionId, questions, candidateName }

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        window.location.href = createPageUrl("Landing");
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
    const started = submissions.filter(
      (s) =>
        s.status === "in-progress" ||
        s.status === "submitted" ||
        s.status === "expired"
    ).length;
    const completed = submissions.filter(
      (s) => s.status === "submitted"
    ).length;
    const expired = submissions.filter((s) => s.status === "expired").length;

    // Calculate average score (only from completed submissions)
    const completedSubmissions = submissions.filter(
      (s) => s.status === "submitted"
    );
    // Note: We don't have score in the submission model yet, so this will be 0 for now
    const avgScore =
      completedSubmissions.length > 0
        ? Math.round(
            completedSubmissions.reduce((sum, s) => sum + (s.score || 0), 0) /
              completedSubmissions.length
          )
        : 0;

    // Calculate average time spent (in minutes)
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
      avgScore,
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

  const getStatusBadge = (status) => {
    const styles = {
      submitted: "bg-green-100 text-green-700",
      "in-progress": "bg-blue-100 text-blue-700",
      pending: "bg-gray-100 text-gray-600",
      expired: "bg-red-100 text-red-700",
    };
    const labels = {
      submitted: "Completed",
      "in-progress": "In Progress",
      pending: "Not Started",
      expired: "Expired",
    };
    return (
      <Badge className={styles[status] || "bg-gray-100 text-gray-600"}>
        {labels[status] || status}
      </Badge>
    );
  };

  const getScoreColor = (score) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const handleGenerateInterview = async (submissionId) => {
    if (!currentUser) return;

    setGeneratingInterview(submissionId);
    setError(null);

    try {
      const token = await currentUser.getIdToken();
      const result = await generateInterviewQuestions(submissionId, token);

      if (result.success) {
        setInterviewQuestions({
          submissionId,
          questions: result.data.questions,
          candidateName: result.data.candidateName,
        });
      } else {
        setError(result.error || "Failed to generate interview questions");
      }
    } catch (err) {
      console.error("Error generating interview:", err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setGeneratingInterview(null);
    }
  };

  const closeInterviewModal = () => {
    setInterviewQuestions(null);
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
          className="grid grid-cols-5 gap-4 mb-8"
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

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Star className="w-5 h-5 text-yellow-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {stats.avgScore}%
            </p>
            <p className="text-sm text-gray-500">Avg Score</p>
          </div>
        </motion.div>

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
                    Score
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
                        {getStatusBadge(submission.status)}
                      </td>
                      <td className="px-5 py-4">
                        {/* Note: Score is not in the submission model yet */}
                        <span className="text-gray-400">—</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatTimeSpent(submission.timeSpent)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {submission.status === "submitted" &&
                            submission.githubLink && (
                              <>
                                <a
                                  href={submission.githubLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
                                  >
                                    <Eye className="w-4 h-4 mr-1" />
                                    View
                                  </Button>
                                </a>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleGenerateInterview(submission._id)
                                  }
                                  disabled={
                                    generatingInterview === submission._id
                                  }
                                  className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
                                >
                                  {generatingInterview === submission._id ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <MessageSquare className="w-4 h-4 mr-1" />
                                      Interview
                                    </>
                                  )}
                                </Button>
                              </>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}

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
                  {interviewQuestions.candidateName && (
                    <p className="text-sm text-gray-500 mt-1">
                      For {interviewQuestions.candidateName}
                    </p>
                  )}
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
    </div>
  );
}
