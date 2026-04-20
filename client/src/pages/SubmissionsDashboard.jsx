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
  Check,
  Send,
  Share2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  BarChart3,
  Loader2,
  Code2,
  Terminal,
  CheckCircle2,
  Circle,
  Play,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  getSubmissionsForAssessment,
  deleteSubmission,
  sendInvites,
  generateShareLink,
} from "@/api/submission";
import { runSubmissionEvaluation } from "@/api/evaluation";
import VideoTimelineWithCriteria from "@/components/proctoring/VideoTimelineWithCriteria";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkInviteContent } from "@/components/BulkInviteModal";
import { getAssessment } from "@/api/assessment";
import { getSessionBySubmission, getTranscriptContent, getProctoringVideoPlaybackUrl, downloadProctoringVideo } from "@/api/proctoring";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { API_BASE_URL } from "@/config/api";
import { getAppOrigin } from "@/config/origins";

/** Format seconds since session start as m:ss (e.g. 65 -> "1:05"). */
function formatSecondsSinceStart(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Human-readable view of the stateful/chunked enriched transcript
 * (session narrative + timeline of behavioral events).
 */
function EnrichedTranscriptView({ enriched }) {
  const narrative = enriched?.session_narrative?.trim();
  const events = Array.isArray(enriched?.events) ? enriched.events : [];
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-h-[40vh] overflow-y-auto space-y-4">
      {narrative ? (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Session summary</p>
          <p className="text-sm text-gray-800 leading-relaxed">{narrative}</p>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Activity timeline</p>
          <ul className="space-y-3">
            {events.map((evt, idx) => (
              <li key={idx} className="border-l-2 border-blue-200 pl-3 py-0.5">
                <span className="text-xs text-gray-500 font-medium">
                  {formatSecondsSinceStart(evt.ts)} – {formatSecondsSinceStart(evt.ts_end)}
                  {evt.ai_tool ? ` · ${evt.ai_tool}` : ""}
                </span>
                <p className="text-sm text-gray-800 mt-0.5">{evt.behavioral_summary}</p>
                {evt.intent ? (
                  <p className="text-xs text-gray-500 mt-0.5 italic">{evt.intent}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!narrative && events.length === 0 ? (
        <p className="text-sm text-gray-500">No activity summary available.</p>
      ) : null}
    </div>
  );
}

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
  const [selectedEvaluationSubmission, setSelectedEvaluationSubmission] =
    useState(null);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [evaluationTab, setEvaluationTab] = useState("execution");
  const [expandedEvidenceCriteria, setExpandedEvidenceCriteria] = useState(new Set());
  const [isDropoffAnalysisExpanded, setIsDropoffAnalysisExpanded] =
    useState(false);
  const [evaluatingSubmissionId, setEvaluatingSubmissionId] = useState(null);
  const [recordingSession, setRecordingSession] = useState(null);
  const [recordingTranscript, setRecordingTranscript] = useState(null);
  const [recordingTranscriptLoading, setRecordingTranscriptLoading] = useState(false);
  const [recordingVideoLoading, setRecordingVideoLoading] = useState(false);
  const [recordingTranscriptError, setRecordingTranscriptError] = useState(null);
  const [recordingVideoObjectUrl, setRecordingVideoObjectUrl] = useState(null);
  const recordingVideoObjectUrlRef = React.useRef(null);
  const { toast } = useToast();

  // Reset expanded evidence when opening evaluation for a different submission
  useEffect(() => {
    if (selectedEvaluationSubmission?._id) {
      setExpandedEvidenceCriteria(new Set());
    }
  }, [selectedEvaluationSubmission?._id]);

  // Default evaluation modal to Final code tab (demo-first)
  useEffect(() => {
    if (showEvaluationModal) {
      setEvaluationTab("execution");
    }
  }, [showEvaluationModal, selectedEvaluationSubmission?._id]);

  // Load proctoring session, screen transcript, and video when Recording tab is active
  useEffect(() => {
    if (
      evaluationTab !== "recording" ||
      !selectedEvaluationSubmission?._id ||
      !currentUser
    ) {
      if (recordingVideoObjectUrlRef.current) {
        URL.revokeObjectURL(recordingVideoObjectUrlRef.current);
        recordingVideoObjectUrlRef.current = null;
      }
      setRecordingVideoObjectUrl(null);
      setRecordingSession(null);
      setRecordingTranscript(null);
      setRecordingTranscriptError(null);
      return;
    }
    const submissionId = String(selectedEvaluationSubmission?._id ?? "");
    if (!submissionId) {
      setRecordingTranscriptLoading(false);
      return;
    }
    console.log("[proctoring-video] client step 1: submissionId =", submissionId, "type:", typeof submissionId, "selectedEvaluationSubmission._id =", selectedEvaluationSubmission._id);
    if (recordingVideoObjectUrlRef.current) {
      URL.revokeObjectURL(recordingVideoObjectUrlRef.current);
      recordingVideoObjectUrlRef.current = null;
    }
    setRecordingVideoObjectUrl(null);
    setRecordingSession(null);
    setRecordingTranscript(null);
    setRecordingTranscriptError(null);
    setRecordingTranscriptLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        console.log("[proctoring-video] client step 2: calling getSessionBySubmission with submissionId =", submissionId);
        const sessionResult = await getSessionBySubmission(submissionId, token);
        if (cancelled) return;
        console.log("[proctoring-video] client step 3: sessionResult.success =", sessionResult.success, "sessionResult.data present =", !!sessionResult.data, "sessionResult.error =", sessionResult.error);
        if (!sessionResult.success || !sessionResult.data) {
          setRecordingTranscriptLoading(false);
          return;
        }
        const session = sessionResult.data;
        const idsMatch = String(session.submissionId) === String(submissionId);
        console.log("[proctoring-video] client step 4: session._id =", session._id, "type:", typeof session._id, "session.submissionId =", session.submissionId, "type:", typeof session.submissionId, "sessionSubmissionId === submissionId =", idsMatch, "String(session.submissionId) =", String(session.submissionId), "submissionId =", submissionId);
        if (String(session.submissionId) !== String(submissionId)) {
          console.log("[proctoring-video] client step 4 FAIL: ids do not match, returning early (no session/video set)");
          setRecordingTranscriptLoading(false);
          return;
        }
        setRecordingSession(session);
        if (
          session.transcript?.status === "completed" &&
          session.transcript?.storageKey &&
          !selectedEvaluationSubmission?.enrichedTranscript
        ) {
          const transcriptResult = await getTranscriptContent(session._id);
          if (cancelled) return;
          if (transcriptResult.success && transcriptResult.data) {
            const lines = transcriptResult.data
              .split("\n")
              .filter((l) => l.trim());
            const segments = lines
              .map((line) => {
                try {
                  const cleaned = line
                    .trim()
                    .replace(/^```(?:json|jsonl)?/, "")
                    .replace(/^```$/, "")
                    .trim();
                  return cleaned ? JSON.parse(cleaned) : null;
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
            setRecordingTranscript(segments);
          }
        }
        if (selectedEvaluationSubmission?.evaluationReport) {
          const sessionIdForVideo =
            session._id != null && typeof session._id === "string"
              ? session._id
              : session._id && typeof session._id.toString === "function"
                ? session._id.toString()
                : String(session._id);
          setRecordingVideoLoading(true);
          console.log("[proctoring-video] client step 5: calling getProctoringVideoPlaybackUrl with session._id =", sessionIdForVideo, "type:", typeof sessionIdForVideo);
          const videoResult = await getProctoringVideoPlaybackUrl(sessionIdForVideo, token);
          if (cancelled) {
            if (videoResult.success && videoResult.data) {
              URL.revokeObjectURL(videoResult.data);
            }
            setRecordingVideoLoading(false);
            return;
          }
          console.log("[proctoring-video] client step 6: videoResult.success =", videoResult.success, "videoResult.error =", videoResult.error, "videoResult.data present =", !!videoResult.data);
          if (videoResult.success && videoResult.data) {
            recordingVideoObjectUrlRef.current = videoResult.data;
            setRecordingVideoObjectUrl(videoResult.data);
          }
          setRecordingVideoLoading(false);
        } else {
          setRecordingVideoLoading(false);
          console.log("[proctoring-video] client step 5 SKIP: no evaluationReport, not fetching video");
        }
      } catch (err) {
        console.log("[proctoring-video] client CAUGHT ERROR:", err?.message ?? err);
        if (!cancelled) {
          setRecordingTranscriptError(err?.message ?? "Failed to load screen transcript");
        }
      } finally {
        if (!cancelled) setRecordingTranscriptLoading(false);
        setRecordingVideoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setRecordingVideoLoading(false);
      if (recordingVideoObjectUrlRef.current) {
        URL.revokeObjectURL(recordingVideoObjectUrlRef.current);
        recordingVideoObjectUrlRef.current = null;
      }
      setRecordingVideoObjectUrl(null);
    };
  }, [
    evaluationTab,
    selectedEvaluationSubmission?._id,
    currentUser,
  ]);

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        window.location.href = createPageUrl("Login");
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch assessment and submissions
  const loadSubmissions = React.useCallback(async () => {
    if (!assessmentId || !currentUser) {
      return;
    }

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
  }, [assessmentId, currentUser]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // Poll submissions while any are waiting for automatic evaluation (transcript + score)
  useEffect(() => {
    const submittedRecently = (s) =>
      s.submittedAt &&
      Date.now() - new Date(s.submittedAt).getTime() < 15 * 60 * 1000;
    const hasPending = submissions.some(
      (s) =>
        s.status === "submitted" &&
        !s.evaluationReport?.criteria_results?.length &&
        (s.evaluationStatus === "pending" ||
          (s.evaluationStatus !== "failed" && submittedRecently(s)))
    );
    if (!hasPending || !assessmentId || !currentUser) return;

    const POLL_MS = 5000;
    const MAX_POLLS = 180; // 15 min
    let polls = 0;
    const interval = setInterval(async () => {
      polls++;
      try {
        const token = await currentUser.getIdToken();
        const result = await getSubmissionsForAssessment(assessmentId, token);
        if (result.success) setSubmissions(result.data || []);
      } catch (_) {}
      if (polls >= MAX_POLLS) clearInterval(interval);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [submissions, assessmentId, currentUser]);

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

  const getSubmissionScore = (sub) => {
    const evaluable =
      sub.evaluationReport?.criteria_results?.filter((r) => r.evaluable) ?? [];
    if (evaluable.length === 0) return -1;
    const sum = evaluable.reduce((s, r) => s + r.score, 0);
    return sum / evaluable.length;
  };

  const sortedSubmissions = [...filteredSubmissions].sort((a, b) => {
    const scoreA = getSubmissionScore(a);
    const scoreB = getSubmissionScore(b);
    return scoreB - scoreA;
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

  const [shareModalSubmission, setShareModalSubmission] = useState(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareEmailSending, setShareEmailSending] = useState(false);
  const [shareEmailSent, setShareEmailSent] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTab, setShareTab] = useState("single");
  const [shareCandidateName, setShareCandidateName] = useState("");
  const [shareCandidateEmail, setShareCandidateEmail] = useState("");
  const [generatedShareLink, setGeneratedShareLink] = useState("");
  const [generatedShareSubmissionId, setGeneratedShareSubmissionId] = useState("");
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);
  const [shareLinkCopiedInModal, setShareLinkCopiedInModal] = useState(false);
  const [shareEmailSendingForGenerated, setShareEmailSendingForGenerated] = useState(false);
  const [shareEmailSentForGenerated, setShareEmailSentForGenerated] = useState(false);

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
    const baseUrl = getAppOrigin();
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

  const openShareModal = (submission) => {
    setShareModalSubmission(submission);
    setShareLinkCopied(false);
    setShareEmailSending(false);
    setShareEmailSent(false);
  };

  const closeShareModal = () => {
    setShareModalSubmission(null);
    setShareLinkCopied(false);
    setShareEmailSending(false);
    setShareEmailSent(false);
  };

  const handleCopyLinkInModal = async () => {
    if (!shareModalSubmission) return;
    const link = getCandidateLink(shareModalSubmission);
    try {
      await navigator.clipboard.writeText(link);
      setShareLinkCopied(true);
      toast({ title: "Link copied", description: "Invite link copied to clipboard." });
      setTimeout(() => setShareLinkCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleSendInviteEmail = async () => {
    if (!shareModalSubmission?._id || !currentUser) return;
    setShareEmailSending(true);
    try {
      const result = await sendInvites([shareModalSubmission._id]);
      if (result.success) {
        setShareEmailSent(true);
        toast({ title: "Invite sent", description: "Invite email sent to candidate." });
      } else {
        toast({
          title: "Failed to send email",
          description: result.error || "Could not send invite email.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setShareEmailSending(false);
    }
  };

  const resetShareModalState = () => {
    setGeneratedShareLink("");
    setGeneratedShareSubmissionId("");
    setShareCandidateName("");
    setShareCandidateEmail("");
    setShareEmailSentForGenerated(false);
  };

  const handleGenerateShareLink = async () => {
    if (!shareCandidateName.trim() || !assessmentId || !currentUser) return;
    setIsGeneratingShareLink(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await generateShareLink(
        {
          assessmentId,
          candidateName: shareCandidateName.trim(),
          ...(shareCandidateEmail.trim() && { candidateEmail: shareCandidateEmail.trim() }),
        },
        token
      );
      if (result.success) {
        setGeneratedShareLink(result.data.shareLink);
        setGeneratedShareSubmissionId(result.data.submissionId);
        loadSubmissions();
      } else {
        const errorMsg = "error" in result ? result.error : "Failed to generate link";
        if (errorMsg.includes("SUBSCRIPTION_LIMIT_REACHED") || errorMsg.includes("limit")) {
          toast({
            title: "Limit reached",
            description: "Free tier allows 3 submissions. Upgrade to invite more candidates.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Failed to generate link",
            description: errorMsg,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Failed to generate link",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  const handleCopyGeneratedShareLink = async () => {
    if (!generatedShareLink) return;
    try {
      await navigator.clipboard.writeText(generatedShareLink);
      setShareLinkCopiedInModal(true);
      toast({ title: "Link copied", description: "Assessment link copied to clipboard." });
      setTimeout(() => setShareLinkCopiedInModal(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleSendEmailForGeneratedLink = async () => {
    if (!generatedShareSubmissionId) return;
    setShareEmailSendingForGenerated(true);
    try {
      const result = await sendInvites([generatedShareSubmissionId]);
      if (result.success) {
        setShareEmailSentForGenerated(true);
        toast({ title: "Invite sent", description: "Invite email sent to candidate." });
      } else {
        toast({
          title: "Failed to send email",
          description: "error" in result ? result.error : "Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to send email",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setShareEmailSendingForGenerated(false);
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
          {assessmentId && (
            <Button
              type="button"
              onClick={() => {
                setShowShareModal(true);
                setShareTab("single");
                resetShareModalState();
              }}
              className="bg-[#1E3A8A] hover:bg-[#152a66] ml-auto flex items-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              Share assessment
            </Button>
          )}
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
        ) : sortedSubmissions.length === 0 ? (
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
                    Time Spent
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Score
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedSubmissions.map((submission) => {
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
                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatTimeSpent(submission.timeSpent)}
                      </td>
                      <td className="px-5 py-4">
                        {(() => {
                          const evaluableCriteria =
                            submission.evaluationReport?.criteria_results?.filter(
                              (r) => r.evaluable
                            ) ?? [];
                          const analysisAvg =
                            evaluableCriteria.length > 0
                              ? (
                                  evaluableCriteria.reduce(
                                    (s, r) => s + r.score,
                                    0
                                  ) / evaluableCriteria.length
                                ).toFixed(1)
                              : null;
                          const hasEvaluationReport =
                            submission.evaluationReport?.criteria_results?.filter(
                              (r) => r.evaluable
                            )?.length > 0;
                          // Show loading while waiting for automatic evaluation (transcript generation + scoring)
                          const submittedRecently =
                            submission.submittedAt &&
                            Date.now() - new Date(submission.submittedAt).getTime() < 15 * 60 * 1000; // 15 min
                          const evaluationPending =
                            submission.status === "submitted" &&
                            !hasEvaluationReport &&
                            (submission.evaluationStatus === "pending" ||
                              (submission.evaluationStatus !== "failed" && submittedRecently));
                          // Show "Run evaluation" only when evaluation actually failed (user can retry)
                          const showRunEvaluation =
                            submission.status === "submitted" &&
                            !hasEvaluationReport &&
                            submission.evaluationStatus === "failed";
                          const openEvaluation = () => {
                            setSelectedEvaluationSubmission(submission);
                            setShowEvaluationModal(true);
                          };
                          const isEvaluating =
                            evaluatingSubmissionId === submission._id;
                          if (analysisAvg != null) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-lg font-bold text-gray-900">
                                  {analysisAvg}
                                </span>
                                <button
                                  type="button"
                                  onClick={openEvaluation}
                                  className="text-left text-xs text-[#1E3A8A] hover:underline"
                                  title="View evaluation"
                                >
                                  View evaluation
                                </button>
                              </div>
                            );
                          }
                          if (evaluationPending) {
                            return (
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                                <span>Evaluating…</span>
                              </div>
                            );
                          }
                          if (showRunEvaluation) {
                            return (
                              <div className="flex flex-col gap-1">
                                <Button
                                    onClick={async () => {
                                      if (!currentUser) {
                                        toast({
                                          title: "Not signed in",
                                          description: "Please sign in to run evaluation.",
                                          variant: "destructive",
                                        });
                                        return;
                                      }
                                      setEvaluatingSubmissionId(submission._id);
                                      try {
                                        const token =
                                          await currentUser.getIdToken();
                                        const result =
                                          await runSubmissionEvaluation(
                                            submission._id,
                                            token
                                          );
                                        if (result.success) {
                                          const submissionsResult =
                                            await getSubmissionsForAssessment(
                                              assessmentId,
                                              token
                                            );
                                          if (submissionsResult.success) {
                                            setSubmissions(
                                              submissionsResult.data || []
                                            );
                                            setSelectedEvaluationSubmission(
                                              submissionsResult.data?.find(
                                                (s) => s._id === submission._id
                                              ) ?? submission
                                            );
                                            toast({
                                              title: "Evaluation complete",
                                              description:
                                                "Workflow evaluation has been updated.",
                                            });
                                          }
                                        } else {
                                          const errMsg =
                                            "error" in result
                                              ? result.error
                                              : "Evaluation failed";
                                          toast({
                                            title: "Evaluation failed",
                                            description: errMsg,
                                            variant: "destructive",
                                          });
                                        }
                                      } catch (error) {
                                        console.error(
                                          "Error running evaluation:",
                                          error
                                        );
                                        toast({
                                          title: "Evaluation failed",
                                          description:
                                            error?.message ||
                                            "An unexpected error occurred.",
                                          variant: "destructive",
                                        });
                                      } finally {
                                        setEvaluatingSubmissionId(null);
                                      }
                                    }}
                                    size="sm"
                                    variant="outline"
                                    disabled={isEvaluating}
                                  >
                                    {isEvaluating
                                      ? "Running…"
                                      : "Run evaluation"}
                                  </Button>
                              </div>
                            );
                          }
                          return (
                            <span className="text-xs text-gray-400">—</span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Share / Copy link — opens popup to copy or send email */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openShareModal(submission);
                            }}
                            className="text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
                            title="Share assessment link or send invite email"
                          >
                            <Send className="w-4 h-4" />
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

        {/* Share assessment modal — single candidate or bulk import */}
        <Dialog
          open={showShareModal}
          onOpenChange={(open) => {
            if (!open) {
              setShowShareModal(false);
              resetShareModalState();
            }
          }}
        >
          <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Share assessment</DialogTitle>
              <DialogDescription>
                Generate a link for one candidate or import multiple at once.
              </DialogDescription>
            </DialogHeader>
            <Tabs
              value={shareTab}
              onValueChange={(v) => {
                setShareTab(v);
                resetShareModalState();
              }}
              className="mt-2"
            >
              <TabsList className="w-full mb-4">
                <TabsTrigger value="single" className="flex-1">
                  Single candidate
                </TabsTrigger>
                <TabsTrigger value="bulk" className="flex-1">
                  Multiple candidates
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single">
                <div className="space-y-4 py-2">
                  {!generatedShareLink ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Candidate name *
                        </label>
                        <Input
                          value={shareCandidateName}
                          onChange={(e) => setShareCandidateName(e.target.value)}
                          placeholder="Enter candidate's full name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Candidate email{" "}
                          <span className="text-gray-400 font-normal">
                            (optional — required to send invite)
                          </span>
                        </label>
                        <Input
                          value={shareCandidateEmail}
                          onChange={(e) => setShareCandidateEmail(e.target.value)}
                          placeholder="candidate@example.com"
                          type="email"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && shareCandidateName.trim())
                              handleGenerateShareLink();
                          }}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowShareModal(false);
                            resetShareModalState();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleGenerateShareLink}
                          disabled={
                            !shareCandidateName.trim() || isGeneratingShareLink
                          }
                          className="bg-[#1E3A8A] hover:bg-[#152a66]"
                        >
                          {isGeneratingShareLink
                            ? "Generating..."
                            : "Generate link"}
                        </Button>
                      </DialogFooter>
                    </>
                  ) : (
                    <>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-800 mb-2">
                          Link generated successfully!
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={generatedShareLink}
                            readOnly
                            className="flex-1 bg-white text-sm"
                          />
                          <Button
                            onClick={handleCopyGeneratedShareLink}
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0"
                          >
                            {shareLinkCopiedInModal ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {shareCandidateEmail.trim() && (
                        <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                          <span className="text-sm text-gray-600">
                            Send invite email to{" "}
                            <span className="font-medium text-gray-900">
                              {shareCandidateEmail.trim()}
                            </span>
                          </span>
                          <Button
                            onClick={handleSendEmailForGeneratedLink}
                            disabled={
                              shareEmailSendingForGenerated ||
                              shareEmailSentForGenerated
                            }
                            size="sm"
                            className="bg-[#1E3A8A] hover:bg-[#152a66] flex-shrink-0 ml-3"
                          >
                            {shareEmailSentForGenerated ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Sent!
                              </>
                            ) : shareEmailSendingForGenerated ? (
                              "Sending..."
                            ) : (
                              "Send email"
                            )}
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-gray-500">
                        Share this link with the candidate. They can access and
                        complete the assessment.
                      </p>
                      <DialogFooter>
                        <Button
                          onClick={() => {
                            setShowShareModal(false);
                            resetShareModalState();
                          }}
                          className="bg-[#1E3A8A] hover:bg-[#152a66]"
                        >
                          Done
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="bulk">
                <BulkInviteContent
                  assessmentId={assessmentId}
                  onSuccess={() => loadSubmissions()}
                  onDone={() => {
                    setShowShareModal(false);
                    resetShareModalState();
                  }}
                />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Share assessment link modal — copy link or send invite email (per row) */}
        <Dialog
          open={!!shareModalSubmission}
          onOpenChange={(open) => {
            if (!open) closeShareModal();
          }}
        >
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Share assessment link</DialogTitle>
              <DialogDescription>
                Copy the link or send an invite email to{" "}
                {shareModalSubmission?.candidateName || "the candidate"}.
              </DialogDescription>
            </DialogHeader>
            {shareModalSubmission && (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={getCandidateLink(shareModalSubmission)}
                    readOnly
                    className="flex-1 bg-gray-50 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLinkInModal}
                    className="flex-shrink-0"
                  >
                    {shareLinkCopied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                {shareModalSubmission.candidateEmail ? (
                  <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg gap-3">
                    <span className="text-sm text-gray-600">
                      Send invite email to{" "}
                      <span className="font-medium text-gray-900">
                        {shareModalSubmission.candidateEmail}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSendInviteEmail}
                      disabled={shareEmailSending || shareEmailSent}
                      className="bg-[#1E3A8A] hover:bg-[#152a66] flex-shrink-0"
                    >
                      {shareEmailSent ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Sent
                        </>
                      ) : shareEmailSending ? (
                        "Sending..."
                      ) : (
                        "Send email"
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No email on file for this candidate. Add an email when
                    generating the link to enable sending invite emails.
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={closeShareModal}
                    className="bg-[#1E3A8A] hover:bg-[#152a66]"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
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

        {/* Evaluation Modal */}
        <Dialog
          open={showEvaluationModal}
          onOpenChange={(open) => {
            if (!open) {
              setShowEvaluationModal(false);
              setSelectedEvaluationSubmission(null);
            }
          }}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Evaluation
                {selectedEvaluationSubmission && (
                  <span className="text-sm font-normal text-gray-500">
                    – {selectedEvaluationSubmission.candidateName ||
                      "Unknown Candidate"}
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>

            <Tabs
              value={evaluationTab}
              onValueChange={setEvaluationTab}
              className="mt-4"
            >
              <TabsList className="w-full justify-start">
                <TabsTrigger value="execution">Final code</TabsTrigger>
                <TabsTrigger value="recording">Workflow evaluation</TabsTrigger>
                <TabsTrigger value="agent">Agent communication</TabsTrigger>
              </TabsList>

              <TabsContent value="execution" className="mt-4">
                <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
                  {/* Final code (demo: visuals only; real pipeline coming soon) */}
                  {selectedEvaluationSubmission?.githubLink ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            <Code2 className="w-4 h-4 text-emerald-600" />
                            Final code
                          </h3>
                          <p className="text-xs text-gray-500 mt-1">
                            We clone the candidate&apos;s repository, run their code and tests, and score the output against the assessment.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                        >
                          <a
                            href={selectedEvaluationSubmission.githubLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            GitHub
                          </a>
                        </Button>
                      </div>

                      {/* Score card */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          {
                            label: "Execution score",
                            value: "87",
                            max: "100",
                            color: "text-emerald-600",
                          },
                          {
                            label: "Tests passed",
                            value: "17",
                            max: "17",
                            color: "text-emerald-600",
                          },
                          {
                            label: "Build",
                            value: "Success",
                            color: "text-emerald-600",
                          },
                          {
                            label: "Output match",
                            value: "92%",
                            color: "text-emerald-600",
                          },
                        ].map((m, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                          >
                            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                              {m.label}
                            </p>
                            <p className={`text-lg font-semibold ${m.color}`}>
                              {m.value}
                              {m.max ? `/${m.max}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Pipeline steps */}
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
                          Pipeline
                        </p>
                        <div className="flex flex-wrap gap-4 sm:gap-6">
                          {[
                            { label: "Clone repository", done: true },
                            { label: "Install dependencies", done: true },
                            { label: "Run test suite", done: true },
                            { label: "Analyze output", done: true },
                          ].map((step, i) => (
                            <div key={i} className="flex items-center gap-2">
                              {step.done ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              ) : (
                                <Circle className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span className="text-sm text-gray-700">
                                {step.label}
                              </span>
                              {i < 3 && (
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400 hidden sm:inline" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Fake terminal output */}
                      <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800/80">
                          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs font-medium text-gray-400">
                            Execution log
                          </span>
                        </div>
                        <pre className="p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre">
                          <span className="text-gray-500">
                            $ git clone{" "}
                            {selectedEvaluationSubmission.githubLink
                              ?.replace(/^https?:\/\//, "")
                              .slice(0, 40)}
                            ...
                          </span>
                          <span className="text-emerald-400">
                            {"\n"}Cloning into &apos;repo&apos;... done.
                          </span>
                          <span className="text-gray-500">
                            {"\n\n"}$ npm install
                          </span>
                          <span className="text-emerald-400">
                            {"\n"}added 127 packages in 4.2s
                          </span>
                          <span className="text-gray-500">
                            {"\n\n"}$ npm test
                          </span>
                          <span className="text-emerald-400">
                            {"\n"}  ✓ tests/unit (12 passed)
                          </span>
                          <span className="text-emerald-400">
                            {"\n"}  ✓ tests/integration (5 passed)
                          </span>
                          <span className="text-gray-300">
                            {"\n\n"}Test Suites: 2 passed, 2 total
                          </span>
                          <span className="text-gray-300">
                            {"\n"}Tests:       17 passed, 17 total
                          </span>
                        </pre>
                      </div>
                      <div className="mt-4 w-full">
                        <Button
                          variant="default"
                          size="default"
                          className="w-full gap-2 font-semibold shadow-sm"
                          asChild
                        >
                          <a
                            href={selectedEvaluationSubmission.githubLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Play className="h-4 w-4 shrink-0" />
                            Run project
                          </a>
                        </Button>
                      </div>

                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <Code2 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-600 text-sm">
                        No GitHub repository link found for this submission.
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Final code appears once a GitHub link is submitted.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="recording" className="mt-4">
                <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
                  {/* Workflow evaluation (when assessment had evaluation criteria) */}
                  {selectedEvaluationSubmission?.evaluationReport ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Workflow evaluation
                      </h3>

                      {/* Overall score only */}
                      {(() => {
                        const report =
                          selectedEvaluationSubmission.evaluationReport;
                        const criteriaResults = report.criteria_results ?? [];
                        const evaluable = criteriaResults.filter(
                          (r) => r.evaluable
                        );
                        const overall =
                          evaluable.length > 0
                            ? evaluable.reduce((s, r) => s + r.score, 0) /
                              evaluable.length
                            : null;
                        const scoreColor =
                          overall != null
                            ? overall >= 7
                              ? "text-emerald-600"
                              : overall >= 4
                                ? "text-amber-600"
                                : "text-gray-700"
                            : "text-gray-500";
                        if (evaluable.length === 0) return null;
                        return (
                          <div className="rounded-xl border-2 border-gray-200 bg-white px-4 py-3 shadow-sm">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Overall score
                            </p>
                            <p className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
                              {overall != null
                                ? (Math.round(overall * 10) / 10).toFixed(1)
                                : "—"}
                              /10
                            </p>
                          </div>
                        );
                      })()}

                      {/* Session summary from evaluation report */}
                      {selectedEvaluationSubmission?.evaluationReport?.session_summary && (
                        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                            Session summary
                          </p>
                          <p className="text-sm text-gray-700 leading-relaxed">
                            {selectedEvaluationSubmission.evaluationReport.session_summary}
                          </p>
                        </div>
                      )}

                      {/* Timeline with criteria highlights from evidence; duration comes from the video */}
                      {(() => {
                        const report =
                          selectedEvaluationSubmission.evaluationReport;
                        const criteriaResults = report.criteria_results ?? [];
                        const highlights = [];
                        for (const r of criteriaResults) {
                          if (!Array.isArray(r.evidence)) continue;
                          for (const ev of r.evidence) {
                            const ts = Number(ev.ts);
                            const tsEnd = Number(ev.ts_end ?? ev.ts);
                            if (!Number.isFinite(ts)) continue;
                            highlights.push({
                              startSec: ts,
                              endSec:
                                Number.isFinite(tsEnd) && tsEnd > ts
                                  ? tsEnd
                                  : undefined,
                              label: ev.observation?.slice(0, 80) ?? "Evidence",
                              category: r.criterion ?? "Evidence",
                              description: ev.observation ?? null,
                              score: r.score,
                            });
                          }
                        }
                        const durationHintSec =
                          recordingSession?.stats?.videoStats?.durationSeconds > 0
                            ? recordingSession.stats.videoStats.durationSeconds
                            : recordingSession?.videoChunks?.length > 0
                              ? (() => {
                                  let sum = 0;
                                  for (const c of recordingSession.videoChunks) {
                                    const start = c.startTime ? new Date(c.startTime).getTime() : NaN;
                                    const end = (c.endTime ? new Date(c.endTime) : c.startTime ? new Date(c.startTime) : null)?.getTime();
                                    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) sum += (end - start) / 1000;
                                  }
                                  return sum > 0 ? sum : undefined;
                                })()
                              : undefined;
                        return (
                          <div className="mb-2 space-y-1">
                            {recordingVideoLoading ? (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden w-full">
                                <div className="relative aspect-video bg-gray-900 flex flex-col items-center justify-center gap-3">
                                  <Loader2 className="w-10 h-10 text-white/80 animate-spin" aria-hidden />
                                  <p className="text-sm text-white/90 font-medium">Loading video…</p>
                                </div>
                              </div>
                            ) : (
                              <VideoTimelineWithCriteria
                                key={selectedEvaluationSubmission._id}
                                highlights={highlights}
                                videoUrl={recordingVideoObjectUrl ?? null}
                                durationHintSec={durationHintSec}
                                className="w-full"
                              />
                            )}
                          </div>
                        );
                      })()}

                      {selectedEvaluationSubmission.evaluationReport
                        .criteria_results?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                            Criteria results
                          </p>
                          <div className="space-y-3">
                            {selectedEvaluationSubmission.evaluationReport.criteria_results.map(
                              (r, i) => {
                                const scoreColor =
                                  r.evaluable
                                    ? r.score >= 7
                                      ? "border-l-emerald-500 bg-emerald-50/50"
                                      : r.score >= 4
                                        ? "border-l-amber-500 bg-amber-50/50"
                                        : "border-l-gray-400 bg-gray-50"
                                    : "border-l-gray-300 bg-gray-50";
                                const scoreTextColor = r.evaluable
                                  ? r.score >= 7
                                    ? "text-emerald-700"
                                    : r.score >= 4
                                      ? "text-amber-700"
                                      : "text-gray-700"
                                  : "text-gray-500";
                                return (
                                <div
                                  key={i}
                                  className={`rounded-lg border border-gray-200 border-l-4 p-4 shadow-sm ${scoreColor}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="font-semibold text-gray-900">
                                      {r.criterion}
                                    </p>
                                    <span className={`text-xl font-bold tabular-nums shrink-0 ${scoreTextColor}`}>
                                      {r.evaluable ? `${r.score}` : "—"}/10
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mt-1 mb-2">
                                    <span className="text-xs text-gray-500">
                                      Confidence: {r.confidence}
                                    </span>
                                    {!r.evaluable && (
                                      <span className="text-amber-600 text-xs">
                                        Not evaluable
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-700 leading-relaxed">
                                    {r.verdict}
                                  </p>
                                  {r.evidence?.length > 0 && (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExpandedEvidenceCriteria(
                                            (prev) => {
                                              const next = new Set(prev);
                                              if (next.has(i)) next.delete(i);
                                              else next.add(i);
                                              return next;
                                            }
                                          );
                                        }}
                                        className="text-[#1E3A8A] hover:underline text-xs font-medium"
                                      >
                                        Evidence: {r.evidence.length} moment(s){" "}
                                        {expandedEvidenceCriteria.has(i)
                                          ? "▼"
                                          : "▶"}
                                      </button>
                                      {expandedEvidenceCriteria.has(i) && (
                                        <ul className="mt-2 space-y-2 pl-3 border-l-2 border-gray-200">
                                          {r.evidence.map((ev, evIdx) => (
                                            <li
                                              key={evIdx}
                                              className="text-xs text-gray-700"
                                            >
                                              <span className="text-gray-500 font-medium">
                                                {ev.ts}s–{ev.ts_end}s
                                              </span>
                                              <p className="mt-0.5 text-gray-600">
                                                {ev.observation}
                                              </p>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </div>
                                );
                              }
                            )}
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-gray-500 pt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {recordingVideoObjectUrl && recordingSession ? (
                          <button
                            type="button"
                            onClick={() => downloadProctoringVideo(recordingSession._id)}
                            className="text-[#1E3A8A] hover:underline"
                          >
                            Download recording
                          </button>
                        ) : null}
                        <Link
                          to="/DemoReplay"
                          className="text-[#1E3A8A] hover:underline"
                        >
                          Timeline demo with sample video
                        </Link>
                      </p>
                    </div>
                  ) : null}

                  {/* Screen transcript: human-readable enriched (stateful chunked) when available, else raw OCR */}
                  {selectedEvaluationSubmission && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#1E3A8A]" />
                        Screen transcript
                      </h3>
                      {selectedEvaluationSubmission.enrichedTranscript ? (
                        <EnrichedTranscriptView enriched={selectedEvaluationSubmission.enrichedTranscript} />
                      ) : recordingTranscriptLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading…
                        </div>
                      ) : recordingTranscriptError ? (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          {recordingTranscriptError}
                        </p>
                      ) : !recordingSession ? (
                        <p className="text-sm text-gray-500">
                          No proctoring session for this submission.
                        </p>
                      ) : recordingSession.transcript?.status !== "completed" ? (
                        <p className="text-sm text-gray-500">
                          Screen transcript not available yet.
                        </p>
                      ) : Array.isArray(recordingTranscript) && recordingTranscript.length > 0 ? (
                        <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-h-[40vh] overflow-y-auto space-y-2">
                          <p className="text-xs text-gray-500 mb-2">Raw transcript (human-readable summary not yet generated)</p>
                          {recordingTranscript.map((seg, idx) => (
                            <div
                              key={idx}
                              className="text-xs border-b border-gray-200 pb-2 last:border-0 last:pb-0"
                            >
                              <span className="text-gray-500 font-medium">
                                {seg.ts && new Date(seg.ts).toLocaleTimeString()}
                                {seg.app ? ` · ${seg.app}` : ""}
                                {seg.region ? ` · ${seg.region}` : ""}
                              </span>
                              <p className="mt-0.5 text-gray-700 break-words">
                                {(seg.text_content || seg.description || "").slice(0, 300)}
                                {(seg.text_content || seg.description || "").length > 300 ? "…" : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No transcript segments.
                        </p>
                      )}
                    </div>
                  )}

                  {!selectedEvaluationSubmission?.evaluationReport && selectedEvaluationSubmission ? (
                    <div className="py-8 text-center">
                      <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-500 mb-3">
                        No workflow evaluation data for this submission.
                      </p>
                      {selectedEvaluationSubmission.evaluationError && (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-md mx-auto">
                          {selectedEvaluationSubmission.evaluationError}
                        </p>
                      )}
                      {!selectedEvaluationSubmission.evaluationError && (
                        <p className="text-xs text-gray-400 mb-4">
                          Evaluation runs automatically after submit when the
                          assessment has evaluation criteria and the candidate
                          used proctoring. You can run it manually below if
                          needed.
                        </p>
                      )}
                      <Button
                        onClick={async () => {
                          if (!currentUser || !selectedEvaluationSubmission)
                            return;
                          setEvaluatingSubmissionId(
                            selectedEvaluationSubmission._id
                          );
                          try {
                            const token = await currentUser.getIdToken();
                            const result = await runSubmissionEvaluation(
                              selectedEvaluationSubmission._id,
                              token
                            );
                            if (result.success) {
                              const submissionsResult =
                                await getSubmissionsForAssessment(
                                  assessmentId,
                                  token
                                );
                              if (submissionsResult.success) {
                                setSubmissions(submissionsResult.data || []);
                                const updated = submissionsResult.data?.find(
                                  (s) =>
                                    s._id === selectedEvaluationSubmission._id
                                );
                                if (updated)
                                  setSelectedEvaluationSubmission(updated);
                                toast({
                                  title: "Evaluation complete",
                                  description:
                                    "Workflow evaluation has been updated.",
                                });
                              }
                            } else {
                              const errMsg =
                                "error" in result
                                  ? result.error
                                  : "Evaluation failed";
                              toast({
                                title: "Evaluation failed",
                                description: errMsg,
                                variant: "destructive",
                              });
                            }
                          } catch (err) {
                            toast({
                              title: "Evaluation failed",
                              description:
                                err?.message || "An unexpected error occurred.",
                              variant: "destructive",
                            });
                          } finally {
                            setEvaluatingSubmissionId(null);
                          }
                        }}
                        disabled={
                          evaluatingSubmissionId ===
                          selectedEvaluationSubmission?._id
                        }
                      >
                        {evaluatingSubmissionId ===
                        selectedEvaluationSubmission?._id
                          ? "Running…"
                          : "Run workflow evaluation"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="agent" className="mt-4">
                <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
                  {selectedEvaluationSubmission?.interview?.transcript?.turns?.length > 0 ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-[#1E3A8A]" />
                        Agent communication
                      </h3>
                      <p className="text-xs text-gray-500">
                        ElevenLabs voice interview: how the candidate communicated with the AI agent.
                      </p>

                      {/* Communication summary & score */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
                          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">Summary</p>
                          <p className="text-sm text-gray-700">
                            {selectedEvaluationSubmission.interview.summary || "No summary generated yet."}
                          </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">Communication score</p>
                          <p className="text-lg font-semibold text-emerald-600">
                            {selectedEvaluationSubmission.interview.analysis?.communicationScore != null
                              ? `${selectedEvaluationSubmission.interview.analysis.communicationScore}/10`
                              : "—"}
                          </p>
                        </div>
                      </div>

                      {/* Transcript */}
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                          Transcript ({selectedEvaluationSubmission.interview.transcript.turns.length} turns)
                        </p>
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4 max-h-[50vh] overflow-y-auto">
                          {selectedEvaluationSubmission.interview.transcript.turns.map((turn, index) => (
                            <div
                              key={index}
                              className={`flex gap-3 ${turn.role === "agent" ? "justify-start" : "justify-end"}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-lg p-3 ${
                                  turn.role === "agent"
                                    ? "bg-white border border-gray-200"
                                    : "bg-[#1E3A8A] text-white"
                                }`}
                              >
                                <p className="text-xs font-medium mb-1 opacity-70">
                                  {turn.role === "agent" ? "Agent" : "Candidate"}
                                </p>
                                <p className={turn.role === "agent" ? "text-sm text-gray-700" : "text-sm text-white"}>
                                  {turn.text}
                                </p>
                                {(turn.startMs != null || turn.endMs != null) && (
                                  <p className="text-xs opacity-60 mt-1">
                                    {turn.startMs != null && `${(turn.startMs / 1000).toFixed(1)}s`}
                                    {turn.startMs != null && turn.endMs != null && " – "}
                                    {turn.endMs != null && `${(turn.endMs / 1000).toFixed(1)}s`}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <MessageSquare className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-600 text-sm">No agent communication for this submission.</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Voice interview transcript appears here after the candidate completes the ElevenLabs interview.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
