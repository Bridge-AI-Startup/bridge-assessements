import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  FileText,
  Plus,
  Share2,
  Clock,
  Timer,
  BarChart3,
  Copy,
  Check,
  Link as LinkIcon,
  Pencil,
  ListChecks,
  Trash2,
  FileCode,
  PlayCircle,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAssessment,
  updateAssessment,
  chatWithAssessment,
} from "@/api/assessment";
import { validateCriterion } from "@/api/evaluation";
import { generateShareLink, sendInvites } from "@/api/submission";
import { auth } from "@/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
import DocumentBlock from "@/components/assessment/DocumentBlock";
import AISidebar from "@/components/assessment/AISidebar";
import { sectionLabel } from "@/components/assessment/sections";
import BehavioralCheckVerification from "@/components/assessment/BehavioralCheckVerification";
import StarterCodeIDE from "@/components/StarterCodeIDE";
import { BulkInviteContent } from "@/components/BulkInviteModal";

/**
 * Pair stored verification specs back up with the check list.
 *
 * Specs are stored keyed by the sentence they verify (that is what the server
 * resolver matches on), but the editor works positionally, so a spec whose
 * sentence has since been rewritten simply has no home and is dropped — exactly
 * what grading already does with it.
 */
function alignSpecsToChecks(checks, storedSpecs) {
  const byText = new Map();
  (Array.isArray(storedSpecs) ? storedSpecs : []).forEach((spec) => {
    if (spec?.text && !byText.has(spec.text.trim())) {
      byText.set(spec.text.trim(), spec);
    }
  });
  return checks.map((text) => byText.get(text.trim()) ?? null);
}

/**
 * Serialize the editor's specs for the API: drop specs whose check was deleted or
 * blanked, restamp `text` to the current wording, and parse JSON bodies that the
 * step editor holds as raw text. A body that is not valid JSON aborts the save
 * rather than silently sending a string where an object was meant.
 */
function serializeCheckSpecs(checks, specs) {
  const out = [];
  checks.forEach((rawText, idx) => {
    const text = typeof rawText === "string" ? rawText.trim() : "";
    const spec = specs[idx];
    if (!text || !spec || spec.kind === "agent") return;

    const parseStep = (step) => {
      if (!step) return step;
      const { json, ...request } = step.request ?? {};
      if (typeof json !== "string" || json.trim() === "") {
        return { ...step, request };
      }
      return { ...step, request: { ...request, json: JSON.parse(json) } };
    };

    let acceptance;
    if (spec.kind === "http") {
      acceptance = parseStep(spec.acceptance);
    } else if (spec.kind === "http_sequence") {
      acceptance = { steps: (spec.acceptance?.steps ?? []).map(parseStep) };
    } else if (spec.kind === "ui") {
      acceptance = spec.acceptance;
    } else {
      acceptance = {
        write: parseStep(spec.acceptance?.write),
        read: parseStep(spec.acceptance?.read),
      };
    }

    out.push({
      id: spec.id || `check-${crypto.randomUUID().slice(0, 8)}`,
      text,
      kind: spec.kind,
      acceptance,
    });
  });
  return out;
}

export default function AssessmentEditor() {
  const [searchParams] = useSearchParams();
  const assessmentId = searchParams.get("id");

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingAssessment, setIsFetchingAssessment] = useState(true);
  const [assessmentData, setAssessmentData] = useState(null); // Store DB assessment data
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [highlightedSection, setHighlightedSection] = useState(null);
  const [lastChange, setLastChange] = useState(null);
  /** Assistant conversation: [{ role, content, error? }], oldest first. */
  const [chatMessages, setChatMessages] = useState([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTab, setShareTab] = useState("single");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [generatedSubmissionId, setGeneratedSubmissionId] = useState("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [contextSections, setContextSections] = useState([]);
  const [timeLimit, setTimeLimit] = useState({ hours: 4, minutes: 0 });
  // "both" (default) | "none" | leftover "workflow"
  const [evidenceMode, setEvidenceMode] = useState("both");
  const [startDeadline, setStartDeadline] = useState(7);
  const [timeLimitSaveTimeout, setTimeLimitSaveTimeout] = useState(null);
  const [starterFilesGitHubLink, setStarterFilesGitHubLink] = useState("");
  const [isEditingStarterFiles, setIsEditingStarterFiles] = useState(false);
  const [editedStarterFilesLink, setEditedStarterFilesLink] = useState("");
  const [behavioralChecks, setBehavioralChecks] = useState([]);
  /** Verification spec per check, aligned by index. `null` = graded by the AI reviewer. */
  const [checkSpecs, setCheckSpecs] = useState([]);
  const [evaluationCriteria, setEvaluationCriteria] = useState([]);
  /** Validation result per criterion text: { [criterion]: { valid: boolean, reason?: string } } */
  const [criteriaValidation, setCriteriaValidation] = useState({});
  const [starterCodeFiles, setStarterCodeFiles] = useState([]);
  const starterCodeSaveTimer = useRef(null);

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log(
        "🔄 [AssessmentEditor] Auth state changed, user:",
        user?.email
      );
      setCurrentUser(user);
      setAuthReady(true);

      if (!user) {
        console.warn(
          "⚠️ [AssessmentEditor] No user found, redirecting to landing"
        );
        window.location.href = createPageUrl("Login");
        return;
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch assessment from database (only after auth is ready)
  useEffect(() => {
    if (!authReady) {
      return; // Wait for auth to be ready
    }

    const fetchAssessment = async () => {
      if (!assessmentId) {
        console.warn("No assessment ID provided");
        setIsFetchingAssessment(false);
        return;
      }

      setIsFetchingAssessment(true);
      try {
        console.log("🔄 [AssessmentEditor] Fetching assessment:", assessmentId);

        // Get token from current user
        const token = currentUser ? await currentUser.getIdToken() : undefined;
        console.log("   Token obtained:", token ? "✅" : "❌");

        const result = await getAssessment(assessmentId, token);

        if (result.success) {
          console.log("✅ [AssessmentEditor] Assessment loaded:", result.data);
          setAssessmentData(result.data);

          // Update timeLimit from database
          const totalMinutes = result.data.timeLimit;
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          setTimeLimit({ hours, minutes });
        } else {
          const errorMsg =
            "error" in result ? result.error : "Failed to load assessment";
          console.error("❌ [AssessmentEditor] Error:", errorMsg);
          alert(errorMsg);
        }
      } catch (err) {
        console.error("❌ [AssessmentEditor] Unexpected error:", err);
        alert("Failed to load assessment");
      } finally {
        setIsFetchingAssessment(false);
      }
    };

    fetchAssessment();
  }, [assessmentId, authReady, currentUser]);

  const handleAddToContext = (section) => {
    setContextSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  };

  // Assessment state - will be updated when data is loaded
  const [assessment, setAssessment] = useState({
    projectDescription:
      "Build a simple REST API for a task management system. The candidate will create endpoints for CRUD operations on tasks and users, implement database relationships, and add basic authentication. This project tests practical backend skills in a realistic scenario.",
  });

  // Update assessment description and title when data is loaded
  useEffect(() => {
    if (assessmentData) {
      if (assessmentData.description) {
        setAssessment((prev) => ({
          ...prev,
          projectDescription: assessmentData.description,
        }));
      }
      if (assessmentData.title) {
        setEditedTitle(assessmentData.title);
      }
      // Update timeLimit from database
      if (assessmentData.timeLimit) {
        const totalMinutes = assessmentData.timeLimit;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        setTimeLimit({ hours, minutes });
      }
      // Legacy documents may hold no field, or the removed "screen"; both
      // resolve to "both" server-side, so mirror that rather than showing the
      // editor a mode that no longer exists.
      setEvidenceMode(
        assessmentData.evidenceMode === "workflow" ||
          assessmentData.evidenceMode === "none"
          ? assessmentData.evidenceMode
          : "both"
      );
      if (assessmentData.behavioralChecks?.length) {
        const checks = assessmentData.behavioralChecks.filter(
          (c) => typeof c === "string"
        );
        setBehavioralChecks(checks);
        setCheckSpecs(
          alignSpecsToChecks(checks, assessmentData.behavioralCheckSpecs)
        );
      } else {
        setBehavioralChecks([]);
        setCheckSpecs([]);
      }
      if (assessmentData.evaluationCriteria) {
        setEvaluationCriteria(
          Array.isArray(assessmentData.evaluationCriteria)
            ? assessmentData.evaluationCriteria.filter((c) => typeof c === "string")
            : []
        );
      }
      // Update starterFilesGitHubLink from database
      if (assessmentData.starterFilesGitHubLink !== undefined) {
        const link = assessmentData.starterFilesGitHubLink || "";
        setStarterFilesGitHubLink(link);
        setEditedStarterFilesLink(link);
      }
      if (assessmentData.starterCodeFiles !== undefined) {
        setStarterCodeFiles(
          Array.isArray(assessmentData.starterCodeFiles)
            ? assessmentData.starterCodeFiles
            : []
        );
      }
    }
  }, [assessmentData]);

  // Auto-save timeLimit when it changes (debounced)
  useEffect(() => {
    if (!assessmentId || !currentUser || !authReady || !assessmentData) {
      return;
    }

    // Clear existing timeout
    if (timeLimitSaveTimeout) {
      clearTimeout(timeLimitSaveTimeout);
    }

    // Calculate total minutes
    const totalMinutes = timeLimit.hours * 60 + timeLimit.minutes;
    const currentTotalMinutes = assessmentData.timeLimit;

    // Only save if it's different from what's in the database and valid
    if (totalMinutes !== currentTotalMinutes && totalMinutes > 0) {
      const timeout = setTimeout(async () => {
        console.log(
          "💾 [AssessmentEditor] Auto-saving timeLimit:",
          totalMinutes
        );
        await handleTimeLimitSave(totalMinutes);
      }, 1000); // Wait 1 second after user stops typing

      setTimeLimitSaveTimeout(timeout);
    }

    return () => {
      if (timeLimitSaveTimeout) {
        clearTimeout(timeLimitSaveTimeout);
      }
    };
  }, [timeLimit, assessmentId, currentUser, authReady, assessmentData]);

  // Save assessment changes to backend
  const saveAssessment = async (updates) => {
    if (!assessmentId || !currentUser) {
      console.warn("Cannot save: missing assessmentId or user");
      return { success: false };
    }

    setIsSaving(true);
    try {
      const token = await currentUser.getIdToken();
      console.log("🔄 [AssessmentEditor] Updating assessment:", updates);

      const result = await updateAssessment(assessmentId, updates, token);

      if (result.success) {
        console.log("✅ [AssessmentEditor] Assessment saved:", result.data);
        setAssessmentData(result.data);
        // Update local state if needed
        if (result.data.description) {
          setAssessment((prev) => ({
            ...prev,
            projectDescription: result.data.description,
          }));
        }
        // Update timeLimit in local state if it changed
        if (result.data.timeLimit) {
          const totalMinutes = result.data.timeLimit;
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          setTimeLimit({ hours, minutes });
        }
        // Update starterFilesGitHubLink in local state if it changed
        if (result.data.starterFilesGitHubLink !== undefined) {
          const link = result.data.starterFilesGitHubLink || "";
          setStarterFilesGitHubLink(link);
          if (!isEditingStarterFiles) {
            setEditedStarterFilesLink(link);
          }
        }
        if (result.data.starterCodeFiles !== undefined) {
          setStarterCodeFiles(
            Array.isArray(result.data.starterCodeFiles)
              ? result.data.starterCodeFiles
              : []
          );
        }
        if (result.data.behavioralChecks !== undefined) {
          const checks = Array.isArray(result.data.behavioralChecks)
            ? result.data.behavioralChecks.filter((c) => typeof c === "string")
            : [];
          setBehavioralChecks(checks);
          setCheckSpecs(
            alignSpecsToChecks(checks, result.data.behavioralCheckSpecs)
          );
        }
        if (result.data.evidenceMode !== undefined) {
          setEvidenceMode(result.data.evidenceMode);
        }
        return result;
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to save assessment";
        console.error("❌ [AssessmentEditor] Save error:", errorMsg);
        alert(errorMsg);
        return { success: false };
      }
    } catch (err) {
      console.error("❌ [AssessmentEditor] Unexpected save error:", err);
      alert("Failed to save assessment");
      return { success: false };
    } finally {
      setIsSaving(false);
    }
  };

  // ========== Save Handlers ==========

  /**
   * Save title changes
   */
  const handleTitleSave = async () => {
    if (editedTitle.trim() && editedTitle !== assessmentData?.title) {
      await saveAssessment({ title: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setEditedTitle(assessmentData?.title || "");
    setIsEditingTitle(false);
  };

  /**
   * Save description changes
   */
  const handleDescriptionSave = async (description) => {
    if (description.trim() && description !== assessmentData?.description) {
      await saveAssessment({ description: description.trim() });
    }
  };

  /**
   * Save timeLimit changes
   */
  const handleTimeLimitSave = async (totalMinutes) => {
    if (totalMinutes > 0 && totalMinutes !== assessmentData?.timeLimit) {
      await saveAssessment({ timeLimit: totalMinutes });
    }
  };

  /**
   * Save starter files GitHub link changes
   */
  const handleStarterFilesSave = async () => {
    const linkToSave = editedStarterFilesLink.trim() || null;
    if (linkToSave !== (assessmentData?.starterFilesGitHubLink || null)) {
      const result = await saveAssessment({
        starterFilesGitHubLink: linkToSave,
      });
      if (result && result.success) {
        setStarterFilesGitHubLink(linkToSave || "");
      }
    } else {
      setStarterFilesGitHubLink(editedStarterFilesLink.trim() || "");
    }
    setIsEditingStarterFiles(false);
  };

  const handleStarterFilesCancel = () => {
    setEditedStarterFilesLink(assessmentData?.starterFilesGitHubLink || "");
    setIsEditingStarterFiles(false);
  };

  const handleChatSubmit = async (message) => {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;

    if (!assessmentId || !currentUser || !assessmentData) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I can't reach this assessment yet. Reload the page and try again.",
          error: true,
        },
      ]);
      return;
    }

    // Everything before this turn is the context the model gets. Error entries
    // are ours, not the model's, so they never go back over the wire.
    const history = chatMessages
      .filter((m) => !m.error)
      .map(({ role, content }) => ({ role, content }));

    setChatMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setIsLoading(true);
    setLastChange(null);

    try {
      const token = await currentUser.getIdToken();

      const result = await chatWithAssessment(
        assessmentId,
        {
          message: trimmed,
          allowedSections:
            contextSections.length > 0 ? contextSections : undefined,
          history,
        },
        token
      );

      if (!result.success) {
        const errorMsg =
          "error" in result ? result.error : "Failed to process chat message";
        console.error("❌ [AssessmentEditor] Chat error:", errorMsg);
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: errorMsg, error: true },
        ]);
        return;
      }

      const {
        changedSections = [],
        changesSummary = [],
        responseMessage: aiResponseMessage,
        assessment: updatedAssessment,
      } = result.data;

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: aiResponseMessage || "Done.",
        },
      ]);

      // The chat route persists its own changes and returns the saved document,
      // so this is the only write the client needs. The `[assessmentData]` effect
      // re-hydrates every editor field from it. Re-saving here (as this used to,
      // via handleTitleSave) read stale closure state and pushed the *old* title
      // back over the one the server had just written.
      if (updatedAssessment) {
        setAssessmentData(updatedAssessment);
      }

      changedSections.forEach((section, index) => {
        setTimeout(() => {
          setHighlightedSection(section);
          setTimeout(() => setHighlightedSection(null), 2000);
        }, index * 500);
      });

      if (changedSections.length > 0) {
        setLastChange({
          section:
            changedSections.length > 1
              ? `${changedSections.length} sections`
              : sectionLabel(changedSections[0]),
          changes: changesSummary.length ? changesSummary : ["Assessment updated"],
        });
      }
    } catch (error) {
      console.error("❌ [AssessmentEditor] Chat error:", error);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error?.message || "Failed to process chat message. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = () => {
    setShareTab("single");
    setCandidateName("");
    setCandidateEmail("");
    setGeneratedLink("");
    setGeneratedSubmissionId("");
    setLinkCopied(false);
    setIsSendingEmail(false);
    setEmailSent(false);
    setShowShareModal(true);
  };

  const handleGenerateLink = async () => {
    if (!candidateName.trim()) return;
    if (!assessmentId || !currentUser) return;
    setIsGeneratingLink(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await generateShareLink(
        {
          assessmentId,
          candidateName: candidateName.trim(),
          ...(candidateEmail.trim() && { candidateEmail: candidateEmail.trim() }),
        },
        token
      );
      if (result.success) {
        setGeneratedLink(result.data.shareLink);
        setGeneratedSubmissionId(result.data.submissionId);
      } else {
        const errorMsg = "error" in result ? result.error : "Failed to generate link";
        if (errorMsg.includes("SUBSCRIPTION_LIMIT_REACHED")) {
          const shouldUpgrade = window.confirm(
            "You've reached a plan limit.\n\nUpgrade to continue.\n\nWould you like to view subscription plans?"
          );
          if (shouldUpgrade) window.location.href = createPageUrl("Subscription");
        } else {
          alert(errorMsg);
        }
      }
    } catch (error) {
      console.error("❌ [AssessmentEditor] Error generating link:", error);
      alert("Failed to generate link. Please try again.");
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (generatedLink) {
      try {
        await navigator.clipboard.writeText(generatedLink);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } catch (error) {
        alert("Failed to copy link to clipboard");
      }
    }
  };

  const handleSendEmail = async () => {
    if (!generatedSubmissionId) return;
    setIsSendingEmail(true);
    try {
      const result = await sendInvites([generatedSubmissionId]);
      if (result.success) {
        setEmailSent(true);
      } else {
        alert("error" in result ? result.error : "Failed to send email");
      }
    } catch (error) {
      alert("Failed to send email. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Show loading state while fetching assessment
  if (isFetchingAssessment) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#21201C]/30 border-t-[#21201C] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading assessment...</p>
        </div>
      </div>
    );
  }

  // Show error state if no assessment ID or failed to load
  if (!assessmentId || !assessmentData) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load assessment</p>
          <Link to={createPageUrl("Home")}>
            <Button>Back to Assessments</Button>
          </Link>
        </div>
      </div>
    );
  }

  // What the evaluation criteria are actually judged against depends on how the
  // session is observed — saying "screen recording" under workflow capture is
  // what made these two lists hard to tell apart.
  const observationIsOff = evidenceMode === "none";
  const observedEvidenceLabel =
    evidenceMode === "workflow"
      ? "the candidate's AI prompts, replies, and code changes"
      : evidenceMode === "both"
        ? "the candidate's AI prompts, replies, and code changes (the screen recording is kept for playback)"
        : "the candidate's screen recording";

  return (
    <div className="min-h-screen bg-[#FAF9F2]">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between mb-8"
        >
          <div>
            <Link
              to={createPageUrl("Home")}
              className="text-sm text-gray-500 hover:text-[#21201C] mb-1 block"
            >
              ← Back to Assessments
            </Link>
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleTitleSave();
                    } else if (e.key === "Escape") {
                      handleTitleCancel();
                    }
                  }}
                  className="text-2xl font-medium tracking-[-0.012em] text-[#21201C] border-[#21201C] focus-visible:ring-[#21201C]"
                  autoFocus
                />
                <Button
                  onClick={handleTitleSave}
                  size="sm"
                  className="bg-[#21201C] hover:bg-[#35332D]"
                  disabled={isSaving}
                >
                  Save
                </Button>
                <Button
                  onClick={handleTitleCancel}
                  size="sm"
                  variant="outline"
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <h1
                className="text-2xl font-medium tracking-[-0.012em] text-[#21201C] cursor-pointer hover:underline"
                onClick={() => setIsEditingTitle(true)}
                title="Click to edit title"
              >
                {assessmentData?.title || "Assessment Editor"}
              </h1>
            )}
            <p className="text-gray-500 text-sm">
              Use Bridge AI to shape your technical assessment — tweak scope,
              difficulty, and structure in one place.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-white px-3 py-2 rounded-lg border border-gray-200">
            <Clock className="w-3.5 h-3.5" />
            <span>
              {isSaving
                ? "Saving..."
                : assessmentData?.updatedAt
                ? `Last updated ${new Date(
                    assessmentData.updatedAt
                  ).toLocaleString()}`
                : "Draft saved"}
            </span>
          </div>
        </motion.div>

        {/* Two Column Layout */}
        <div className="flex gap-6">
          {/* Left Column - Document */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex-1 space-y-4"
          >
            {/* Project Description */}
            <DocumentBlock
              title="Project Description"
              icon={FileText}
              isActive={false}
              isHighlighted={highlightedSection === "projectDescription"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("projectDescription")}
              isInContext={contextSections.includes("projectDescription")}
              editValue={assessment.projectDescription}
              onEdit={async (value) => {
                // Update local state
                setAssessment((prev) => ({
                  ...prev,
                  projectDescription: value,
                }));
                // Save to backend
                await handleDescriptionSave(value);
              }}
            >
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
                  {assessment.projectDescription}
                </ReactMarkdown>
              </div>
            </DocumentBlock>

            {/* Time & Deadlines */}
            <DocumentBlock
              title="Time & Deadlines"
              icon={Timer}
              isActive={false}
              isHighlighted={highlightedSection === "timeLimit"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("timeLimit")}
              isInContext={contextSections.includes("timeLimit")}
            >
              <div className="space-y-6">
                {/* Time to complete */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Time to complete
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Maximum time candidates have once they start the assessment.
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="72"
                        value={timeLimit.hours}
                        onChange={(e) =>
                          setTimeLimit((prev) => ({
                            ...prev,
                            hours: parseInt(e.target.value) || 0,
                          }))
                        }
                        className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]"
                      />
                      <span className="text-sm text-gray-500">hours</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={timeLimit.minutes}
                        onChange={(e) =>
                          setTimeLimit((prev) => ({
                            ...prev,
                            minutes: parseInt(e.target.value) || 0,
                          }))
                        }
                        className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]"
                      />
                      <span className="text-sm text-gray-500">minutes</span>
                    </div>
                  </div>
                </div>

                {/* How we observe the candidate working */}
                <div className="pt-4 border-t border-gray-100">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    How we observe the session
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Observation records the screen for you to watch and captures
                    the candidate&apos;s AI prompts, replies, and code changes
                    for scoring — they run a short setup command and work in
                    their own environment. None turns that off. Evaluation
                    criteria are judged against this record; behavioral checks
                    still run on the submitted code either way.
                  </p>
                  <div className="space-y-2">
                    {[
                      ...(evidenceMode === "workflow"
                        ? [
                            {
                              value: "workflow",
                              label: "Workflow capture",
                              hint: "Records AI prompts, replies, and code changes with no screen share. Previous option — pick another to change it.",
                            },
                          ]
                        : []),
                      {
                        value: "both",
                        label: "Observe session (default)",
                        hint: "Records the screen for playback; scoring uses the captured AI workflow.",
                      },
                      {
                        value: "none",
                        label: "None",
                        hint: "No screen recording and no capture of the candidate's AI workflow.",
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors"
                      >
                        <input
                          type="radio"
                          name="evidenceMode"
                          value={option.value}
                          checked={evidenceMode === option.value}
                          onChange={async (e) => {
                            const next = e.target.value;
                            const prev = evidenceMode;
                            setEvidenceMode(next);
                            const result = await saveAssessment({
                              evidenceMode: next,
                            });
                            if (!result?.success) {
                              setEvidenceMode(prev);
                            }
                          }}
                          className="mt-1"
                        />
                        <span>
                          <span className="text-sm font-medium text-gray-700 block">
                            {option.label}
                          </span>
                          <span className="text-xs text-gray-500">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Deadline to start */}
                <div className="pt-4 border-t border-gray-100">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Deadline to start
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    How long candidates have to begin the assessment after
                    receiving the link.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={startDeadline}
                      onChange={(e) =>
                        setStartDeadline(parseInt(e.target.value) || 1)
                      }
                      className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]"
                    />
                    <span className="text-sm text-gray-500">days</span>
                  </div>
                </div>
              </div>
            </DocumentBlock>

            {/* Starter Files */}
            <DocumentBlock
              title="Starter Files"
              icon={LinkIcon}
              isActive={false}
              isHighlighted={highlightedSection === "starterFiles"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("starterFiles")}
              isInContext={contextSections.includes("starterFiles")}
            >
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      GitHub Repository Link (Optional)
                    </label>
                    {!isEditingStarterFiles ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditedStarterFilesLink(starterFilesGitHubLink);
                          setIsEditingStarterFiles(true);
                        }}
                        className="h-7 px-2 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />
                        Edit
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStarterFilesCancel}
                          className="h-7 px-2 text-xs"
                          disabled={isSaving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleStarterFilesSave}
                          className="h-7 px-2 text-xs bg-[#21201C] hover:bg-[#35332D]"
                          disabled={isSaving}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Provide a GitHub repository link with starter files and
                    instructions. Candidates will have access to this link when
                    they start the assessment.
                  </p>
                  {isEditingStarterFiles ? (
                    <input
                      type="url"
                      value={editedStarterFilesLink}
                      onChange={(e) =>
                        setEditedStarterFilesLink(e.target.value)
                      }
                      placeholder="https://github.com/username/repo"
                      className="w-full text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]"
                    />
                  ) : (
                    <div
                      onClick={() => {
                        setEditedStarterFilesLink(starterFilesGitHubLink);
                        setIsEditingStarterFiles(true);
                      }}
                      className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 cursor-text hover:bg-gray-100 transition-colors"
                    >
                      {starterFilesGitHubLink || (
                        <span className="text-gray-400 italic">
                          No GitHub link set. Click to add a link.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Starter code (inline files) */}
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <FileCode className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">
                      Starter code files
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Add inline starter code files for candidates to view and download as a ZIP.
                  </p>
                  <StarterCodeIDE
                    files={starterCodeFiles}
                    readOnly={false}
                    onChange={(files) => {
                      setStarterCodeFiles(files);
                      if (starterCodeSaveTimer.current) clearTimeout(starterCodeSaveTimer.current);
                      starterCodeSaveTimer.current = setTimeout(() => {
                        saveAssessment({ starterCodeFiles: files });
                      }, 600);
                    }}
                  />
                  {starterCodeFiles.length === 0 && (
                    <p className="text-xs text-gray-400 mt-2">No starter code files yet. Files will be auto-generated when you create an assessment with AI.</p>
                  )}
                </div>
              </div>
            </DocumentBlock>

            {/* Scoring overview — the two lists below are easy to confuse, so
                contrast them before either one is shown. */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <span className="eyebrow text-gray-500">Scoring</span>
              <p className="text-sm text-gray-700 mt-1.5 mb-3">
                Each submission is scored on two separate things.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex gap-2.5">
                  <PlayCircle className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                  <span>
                    <span className="text-sm font-medium text-gray-800 block">
                      Behavioral checks — what they built
                    </span>
                    <span className="text-xs text-gray-500">
                      We run their submitted code and check the product actually
                      does these things.
                    </span>
                  </span>
                </div>
                <div className="flex gap-2.5">
                  <ListChecks className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                  <span>
                    <span className="text-sm font-medium text-gray-800 block">
                      Evaluation criteria — how they worked
                    </span>
                    <span className="text-xs text-gray-500">
                      We judge the observed session — their process, not the
                      finished product — against these.
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Behavioral checks (shared product bar for all candidates) */}
            <DocumentBlock
              title="Behavioral checks"
              subtitle="What the finished product must do"
              icon={PlayCircle}
              isActive={false}
              isHighlighted={highlightedSection === "behavioralChecks"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("behavioralChecks")}
              isInContext={contextSections.includes("behavioralChecks")}
            >
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  Plain-language behaviors every submission on this assessment
                  should satisfy (e.g. “User can add a note”). We verify them by
                  running the candidate&apos;s submitted code, so they say
                  nothing about how the candidate got there — that&apos;s
                  evaluation criteria below. Keep them stack-agnostic: not tied
                  to a specific API or file. Edit or add lines below, then save.
                </p>
                {behavioralChecks.length === 0 ? (
                  <p className="text-sm text-gray-500 italic border border-dashed border-gray-200 rounded-lg px-3 py-4 bg-gray-50/80">
                    No behavioral checks yet. They are generated when you create
                    an assessment with AI, or you can add your own.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {behavioralChecks.map((check, idx) => (
                      <li key={idx}>
                        <div className="flex gap-2 items-start">
                          <span
                            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#21201C]/70"
                            aria-hidden
                          />
                          <input
                            type="text"
                            value={check}
                            onChange={(e) =>
                              setBehavioralChecks((prev) => {
                                const next = [...prev];
                                next[idx] = e.target.value;
                                return next;
                              })
                            }
                            className="flex-1 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]"
                            placeholder="Observable behavior…"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setBehavioralChecks((prev) =>
                                prev.filter((_, i) => i !== idx)
                              );
                              setCheckSpecs((prev) =>
                                prev.filter((_, i) => i !== idx)
                              );
                            }}
                            className="text-gray-500 hover:text-red-600 p-2 h-9 w-9 shrink-0"
                            aria-label="Remove check"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <BehavioralCheckVerification
                          spec={checkSpecs[idx] ?? null}
                          onChange={(next) =>
                            setCheckSpecs((prev) => {
                              const copy = [...prev];
                              while (copy.length < behavioralChecks.length) {
                                copy.push(null);
                              }
                              copy[idx] = next;
                              return copy;
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBehavioralChecks((prev) => [...prev, ""]);
                      setCheckSpecs((prev) => [
                        ...prev,
                        {
                          kind: "ui",
                          acceptance: {
                            steps: [
                              { action: "goto", path: "/" },
                              {
                                action: "fill_placeholder",
                                placeholder: "",
                                value: "{{nonce}}",
                              },
                              { action: "click_text", text: "" },
                              { action: "expect_text", text: "{{nonce}}" },
                            ],
                          },
                        },
                      ]);
                    }}
                    className="text-sm"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add check
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      const kept = behavioralChecks
                        .map((c, i) => ({
                          text: typeof c === "string" ? c.trim() : "",
                          spec: checkSpecs[i] ?? null,
                        }))
                        .filter((row) => row.text);
                      const checks = kept.map((row) => row.text);
                      let specs;
                      try {
                        specs = serializeCheckSpecs(
                          checks,
                          kept.map((row) => row.spec)
                        );
                      } catch {
                        alert(
                          "A request body under “How is this verified?” is not valid JSON. Fix it and save again."
                        );
                        return;
                      }
                      await saveAssessment({
                        behavioralChecks: checks,
                        behavioralCheckSpecs: specs,
                      });
                      setBehavioralChecks(checks);
                      setCheckSpecs(alignSpecsToChecks(checks, specs));
                    }}
                    disabled={isSaving}
                    className="text-sm bg-[#21201C] hover:bg-[#35332D]"
                  >
                    Save behavioral checks
                  </Button>
                </div>
              </div>
            </DocumentBlock>

            {/* Evaluation criteria (judged from the observed session) */}
            <DocumentBlock
              title="Evaluation criteria"
              subtitle="How the candidate worked to get there"
              icon={ListChecks}
              isActive={false}
              isHighlighted={highlightedSection === "evaluationCriteria"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("evaluationCriteria")}
              isInContext={contextSections.includes("evaluationCriteria")}
            >
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  Criteria used to judge {observedEvidenceLabel} — the process,
                  not whether the finished product works (that&apos;s behavioral
                  checks above). Add, edit, or suggest from the project
                  description.
                </p>
                {observationIsOff && (
                  <p className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                    Observation is currently off, so these criteria aren&apos;t
                    scored. Pick “Observe session” under{" "}
                    <span className="font-medium">
                      Time &amp; Deadlines → How we observe the session
                    </span>{" "}
                    to use them. Behavioral checks still run either way.
                  </p>
                )}
                <div className="space-y-2">
                  {evaluationCriteria.map((criterion, idx) => {
                    const validation = criteriaValidation[criterion];
                    const isInvalid =
                      validation && typeof validation.valid === "boolean" && !validation.valid;
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={criterion}
                            onChange={(e) =>
                              setEvaluationCriteria((prev) => {
                                const next = [...prev];
                                next[idx] = e.target.value;
                                return next;
                              })
                            }
                            placeholder="e.g. Candidate explains their approach clearly"
                            className={`flex-1 text-sm text-gray-700 bg-white border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C] ${
                              isInvalid ? "border-amber-500" : "border-gray-200"
                            }`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setEvaluationCriteria((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-gray-500 hover:text-red-600 p-2 h-8 w-8"
                            aria-label="Remove criterion"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        {isInvalid && validation?.reason && (
                          <p className="text-xs text-amber-700 pl-1">
                            Not evaluable: {validation.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEvaluationCriteria((prev) => [...prev, ""])
                    }
                    className="text-sm"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add criterion
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      const criteria = evaluationCriteria
                        .map((c) => (typeof c === "string" ? c.trim() : ""))
                        .filter(Boolean);
                      await saveAssessment({ evaluationCriteria: criteria });
                      setEvaluationCriteria(criteria);
                      const token = await auth.currentUser?.getIdToken();
                      const results = await Promise.all(
                        criteria.map((c) =>
                          validateCriterion(c, token, evidenceMode)
                        )
                      );
                      const nextValidation = {};
                      criteria.forEach((c, i) => {
                        const r = results[i];
                        nextValidation[c] =
                          r?.success && typeof r.data?.valid === "boolean"
                            ? { valid: r.data.valid, reason: r.data.reason }
                            : { valid: true };
                      });
                      setCriteriaValidation(nextValidation);
                    }}
                    disabled={isSaving}
                    className="text-sm bg-[#21201C] hover:bg-[#35332D]"
                  >
                    Save criteria
                  </Button>
                </div>
              </div>
            </DocumentBlock>

            {/* Bottom Sticky Bar */}
            <div className="sticky bottom-0 bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-end mt-6">
              <div className="flex gap-3">
                <Link
                  to={
                    createPageUrl("SubmissionsDashboard") +
                    `?assessmentId=${assessmentId}`
                  }
                >
                  <Button
                    variant="outline"
                    className="px-5 h-10 rounded-full text-sm border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    <BarChart3 className="w-4 h-4 mr-2" />
                    View submissions
                  </Button>
                </Link>
                <Button
                  onClick={handleShare}
                  className="px-5 h-10 rounded-full text-sm bg-[#21201C] hover:bg-[#35332D] text-[#FAF9F2] shadow-sm hover:shadow-md hover:scale-105 transition-all"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share assessment link
                </Button>
              </div>
            </div>
          </motion.div>

          {/* Right Column - AI Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="w-[380px] flex-shrink-0"
          >
            <AISidebar
              onSubmit={handleChatSubmit}
              isLoading={isLoading}
              messages={chatMessages}
              contextSections={contextSections}
              onRemoveContext={(section) =>
                setContextSections((prev) => prev.filter((s) => s !== section))
              }
              lastChange={lastChange}
            />
          </motion.div>
        </div>
      </div>


      {/* Share Modal — single candidate or bulk import */}
      <Dialog open={showShareModal} onOpenChange={(open) => { if (!open) setShowShareModal(false); }}>
        <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Share Assessment</DialogTitle>
            <DialogDescription>
              Send to one candidate or import multiple at once.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={shareTab} onValueChange={(v) => { setShareTab(v); setGeneratedLink(""); setGeneratedSubmissionId(""); setCandidateName(""); setCandidateEmail(""); setEmailSent(false); }} className="mt-2">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="single" className="flex-1">Single candidate</TabsTrigger>
              <TabsTrigger value="bulk" className="flex-1">Multiple candidates</TabsTrigger>
            </TabsList>

            {/* Single candidate tab */}
            <TabsContent value="single">
              <div className="space-y-4 py-2">
                {!generatedLink ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Candidate Name *
                      </label>
                      <Input
                        value={candidateName}
                        onChange={(e) => setCandidateName(e.target.value)}
                        placeholder="Enter candidate's full name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Candidate Email <span className="text-gray-400 font-normal">(optional — required to send invite)</span>
                      </label>
                      <Input
                        value={candidateEmail}
                        onChange={(e) => setCandidateEmail(e.target.value)}
                        placeholder="candidate@example.com"
                        type="email"
                        onKeyDown={(e) => { if (e.key === "Enter" && candidateName.trim()) handleGenerateLink(); }}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowShareModal(false)}>Cancel</Button>
                      <Button
                        onClick={handleGenerateLink}
                        disabled={!candidateName.trim() || isGeneratingLink}
                        className="bg-[#21201C] hover:bg-[#35332D]"
                      >
                        {isGeneratingLink ? "Generating..." : "Generate Link"}
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800 mb-2">Link generated successfully!</p>
                      <div className="flex items-center gap-2">
                        <Input value={generatedLink} readOnly className="flex-1 bg-white text-sm" />
                        <Button onClick={handleCopyLink} size="sm" variant="outline" className="flex-shrink-0">
                          {linkCopied ? (
                            <><Check className="w-4 h-4 mr-2" />Copied!</>
                          ) : (
                            <><Copy className="w-4 h-4 mr-2" />Copy</>
                          )}
                        </Button>
                      </div>
                    </div>
                    {candidateEmail.trim() && (
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                        <span className="text-sm text-gray-600">Send invite email to <span className="font-medium text-gray-900">{candidateEmail.trim()}</span></span>
                        <Button
                          onClick={handleSendEmail}
                          disabled={isSendingEmail || emailSent}
                          size="sm"
                          className="bg-[#21201C] hover:bg-[#35332D] flex-shrink-0 ml-3"
                        >
                          {emailSent ? (
                            <><Check className="w-4 h-4 mr-2" />Sent!</>
                          ) : isSendingEmail ? "Sending..." : "Send Email"}
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-gray-500">Share this link with the candidate. They will be able to access and complete the assessment.</p>
                    <DialogFooter>
                      <Button
                        onClick={() => { setShowShareModal(false); setGeneratedLink(""); setCandidateName(""); setCandidateEmail(""); setEmailSent(false); }}
                        className="bg-[#21201C] hover:bg-[#35332D]"
                      >
                        Done
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </div>
            </TabsContent>

            {/* Bulk import tab */}
            <TabsContent value="bulk">
              <BulkInviteContent
                assessmentId={assessmentId}
                onDone={() => setShowShareModal(false)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
