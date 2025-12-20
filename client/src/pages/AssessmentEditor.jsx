import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import {
  FileText,
  Target,
  Plus,
  Eye,
  Share2,
  Clock,
  FlaskConical,
  BrainCircuit,
  User,
  Timer,
  BarChart3,
  Copy,
  Check,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Switch } from "@/components/ui/switch";
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
import {
  getAssessment,
  updateAssessment,
  chatWithAssessment,
} from "@/api/assessment";
import { generateShareLink } from "@/api/submission";
import { auth } from "@/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";
import DocumentBlock, {
  RubricItem,
  TestCaseItem,
} from "@/components/assessment/DocumentBlock";
import AISidebar from "@/components/assessment/AISidebar";
import CandidatePreviewModal from "@/components/assessment/CandidatePreviewModal";

export default function AssessmentEditor() {
  const [searchParams] = useSearchParams();
  const assessmentId = searchParams.get("id");

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingAssessment, setIsFetchingAssessment] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [assessmentData, setAssessmentData] = useState(null); // Store DB assessment data
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [highlightedSection, setHighlightedSection] = useState(null);
  const [lastChange, setLastChange] = useState(null);
  const [responseMessage, setResponseMessage] = useState(null);
  const [isSmartInterviewerEnabled, setIsSmartInterviewerEnabled] =
    useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [interviewerPrompt, setInterviewerPrompt] = useState("");
  const [contextSections, setContextSections] = useState([]);
  const [timeLimit, setTimeLimit] = useState({ hours: 4, minutes: 0 });
  const [startDeadline, setStartDeadline] = useState(7);
  const [timeLimitSaveTimeout, setTimeLimitSaveTimeout] = useState(null);

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
        window.location.href = createPageUrl("Landing");
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
    interviewQuestions: [
      "Walk me through how you structured your database schema and why.",
      "How did you handle authentication? What alternatives did you consider?",
      "What was the most challenging part of this project?",
      "How would you scale this API to handle 10,000 concurrent users?",
      "If you had more time, what would you improve?",
    ],
    rubric: [
      { criteria: "Code Quality", weight: "25%" },
      { criteria: "API Design", weight: "25%" },
      { criteria: "Database Modeling", weight: "20%" },
      { criteria: "Testing", weight: "15%" },
      { criteria: "Documentation", weight: "15%" },
    ],
    testCases: [
      { name: "User registration creates valid JWT", type: "unit", points: 10 },
      {
        name: "Tasks CRUD operations work correctly",
        type: "integration",
        points: 15,
      },
      { name: "Unauthorized access returns 401", type: "unit", points: 10 },
      {
        name: "Database relationships are maintained",
        type: "integration",
        points: 15,
      },
    ],
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
      return;
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
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to save assessment";
        console.error("❌ [AssessmentEditor] Save error:", errorMsg);
        alert(errorMsg);
      }
    } catch (err) {
      console.error("❌ [AssessmentEditor] Unexpected save error:", err);
      alert("Failed to save assessment");
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

  const handleChatSubmit = async (message) => {
    if (!assessmentId || !currentUser || !assessmentData) {
      alert("Cannot chat: missing assessment data or user");
      return;
    }

    setIsLoading(true);
    setResponseMessage(null); // Clear previous response message

    try {
      console.log("💬 [AssessmentEditor] Sending chat message:", message);

      // Get token from current user
      const token = await currentUser.getIdToken();

      // Prepare chat request with current assessment context
      const chatRequest = {
        message: message.trim(),
        allowedSections:
          contextSections.length > 0 ? contextSections : undefined,
        rubric: assessment.rubric,
        testCases: assessment.testCases,
      };

      const result = await chatWithAssessment(assessmentId, chatRequest, token);

      if (!result.success) {
        const errorMsg =
          "error" in result ? result.error : "Failed to process chat message";
        console.error("❌ [AssessmentEditor] Chat error:", errorMsg);
        alert(errorMsg);
        setIsLoading(false);
        return;
      }

      const {
        updates,
        changedSections,
        changesSummary,
        responseMessage: aiResponseMessage,
        assessment: updatedAssessment,
      } = result.data;

      console.log("✅ [AssessmentEditor] Chat successful:", {
        changedSections,
        changesSummary,
        responseMessage: aiResponseMessage,
      });

      // Set response message to display in chat
      if (aiResponseMessage) {
        setResponseMessage(aiResponseMessage);
      }

      // Update local assessment state with frontend-only fields
      if (updates.rubric) {
        setAssessment((prev) => ({
          ...prev,
          rubric: updates.rubric,
        }));
      }
      if (updates.testCases) {
        setAssessment((prev) => ({
          ...prev,
          testCases: updates.testCases,
        }));
      }

      // Update database-backed fields
      if (updates.description) {
        setAssessment((prev) => ({
          ...prev,
          projectDescription: updates.description,
        }));
        // Save to backend
        await handleDescriptionSave(updates.description);
      }
      if (updates.title) {
        setEditedTitle(updates.title);
        await handleTitleSave();
      }
      if (updates.timeLimit !== undefined) {
        const hours = Math.floor(updates.timeLimit / 60);
        const minutes = updates.timeLimit % 60;
        setTimeLimit({ hours, minutes });
        await handleTimeLimitSave(updates.timeLimit);
      }
      if (updates.scoring) {
        // Note: scoring updates would need to be saved if we add that field to the update endpoint
        console.log("📊 [AssessmentEditor] Scoring updated:", updates.scoring);
      }

      // Update assessmentData if backend returned updated assessment
      if (updatedAssessment) {
        setAssessmentData(updatedAssessment);
      }

      // Highlight changed sections
      if (changedSections?.length) {
        console.log(
          "🎯 [AssessmentEditor] Highlighting sections:",
          changedSections
        );
        changedSections.forEach((section, index) => {
          setTimeout(() => {
            // Normalize section name to match frontend expectations
            const normalizedSection =
              section === "description" ? "projectDescription" : section;
            console.log(`   Highlighting section: ${normalizedSection}`);
            setHighlightedSection(normalizedSection);
            setTimeout(() => {
              setHighlightedSection(null);
              console.log(`   Unhighlighting section: ${normalizedSection}`);
            }, 2000);
          }, index * 500);
        });
      } else {
        console.warn(
          "⚠️ [AssessmentEditor] No changedSections received from backend"
        );
      }

      // Set last change summary
      setLastChange({
        section:
          changedSections.length > 1
            ? `${changedSections.length} sections`
            : changedSections[0] || "assessment",
        changes: changesSummary || ["Assessment updated"],
      });
    } catch (error) {
      console.error("❌ [AssessmentEditor] Chat error:", error);
      alert("Failed to process chat message. Please try again.");
    }

    setIsLoading(false);
  };

  const handleShare = () => {
    setShowShareModal(true);
    setCandidateName("");
    setGeneratedLink("");
    setLinkCopied(false);
  };

  const handleGenerateLink = async () => {
    if (!candidateName.trim()) {
      alert("Please enter a candidate name");
      return;
    }

    if (!assessmentId || !currentUser) {
      alert("Cannot generate link: missing assessment data or user");
      return;
    }

    setIsGeneratingLink(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await generateShareLink(
        {
          assessmentId,
          candidateName: candidateName.trim(),
        },
        token
      );

      if (result.success) {
        setGeneratedLink(result.data.shareLink);
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to generate link";
        alert(errorMsg);
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
        console.error("Failed to copy link:", error);
        alert("Failed to copy link to clipboard");
      }
    }
  };

  // Show loading state while fetching assessment
  if (isFetchingAssessment) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading assessment...</p>
        </div>
      </div>
    );
  }

  // Show error state if no assessment ID or failed to load
  if (!assessmentId || !assessmentData) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load assessment</p>
          <Link to={createPageUrl("Home")}>
            <Button>Back to Assessments</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
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
              className="text-sm text-gray-500 hover:text-[#1E3A8A] mb-1 block"
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
                  className="text-2xl font-bold text-[#1E3A8A] border-[#1E3A8A] focus-visible:ring-[#1E3A8A]"
                  autoFocus
                />
                <Button
                  onClick={handleTitleSave}
                  size="sm"
                  className="bg-[#1E3A8A] hover:bg-[#152a66]"
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
                className="text-2xl font-bold text-[#1E3A8A] cursor-pointer hover:underline"
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

            {/* Scoring & Rubric */}
            <DocumentBlock
              title="Scoring & Rubric"
              icon={Target}
              isActive={false}
              isHighlighted={highlightedSection === "rubric"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("rubric")}
              isInContext={contextSections.includes("rubric")}
            >
              <div className="space-y-1">
                {assessment.rubric.map((item, index) => (
                  <RubricItem
                    key={index}
                    criteria={item.criteria}
                    weight={item.weight}
                    onEdit={(criteria, weight) => {
                      setAssessment((prev) => ({
                        ...prev,
                        rubric: prev.rubric.map((r, i) =>
                          i === index ? { criteria, weight } : r
                        ),
                      }));
                    }}
                    onDelete={() => {
                      setAssessment((prev) => ({
                        ...prev,
                        rubric: prev.rubric.filter((_, i) => i !== index),
                      }));
                    }}
                  />
                ))}
              </div>
              <button
                onClick={() =>
                  setAssessment((prev) => ({
                    ...prev,
                    rubric: [
                      ...prev.rubric,
                      { criteria: "New Criteria", weight: "10%" },
                    ],
                  }))
                }
                className="mt-4 text-sm text-[#1E3A8A] hover:text-[#1E3A8A]/80 flex items-center gap-1.5 font-medium"
              >
                <Plus className="w-4 h-4" />
                Add rubric item
              </button>
            </DocumentBlock>

            {/* Test Cases */}
            <DocumentBlock
              title="Test Cases"
              icon={FlaskConical}
              isActive={false}
              isHighlighted={highlightedSection === "testCases"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("testCases")}
              isInContext={contextSections.includes("testCases")}
            >
              <div className="space-y-1">
                {assessment.testCases.map((testCase, index) => (
                  <TestCaseItem
                    key={index}
                    name={testCase.name}
                    type={testCase.type}
                    points={testCase.points}
                    onEdit={(name, type, points) => {
                      setAssessment((prev) => ({
                        ...prev,
                        testCases: prev.testCases.map((t, i) =>
                          i === index ? { name, type, points } : t
                        ),
                      }));
                    }}
                    onDelete={() => {
                      setAssessment((prev) => ({
                        ...prev,
                        testCases: prev.testCases.filter((_, i) => i !== index),
                      }));
                    }}
                  />
                ))}
              </div>
              <button
                onClick={() =>
                  setAssessment((prev) => ({
                    ...prev,
                    testCases: [
                      ...prev.testCases,
                      { name: "New test case", type: "unit", points: 10 },
                    ],
                  }))
                }
                className="mt-4 text-sm text-[#1E3A8A] hover:text-[#1E3A8A]/80 flex items-center gap-1.5 font-medium"
              >
                <Plus className="w-4 h-4" />
                Add test case
              </button>
            </DocumentBlock>

            {/* Smart AI Interviewer */}
            <DocumentBlock
              title="Smart AI Interviewer"
              icon={BrainCircuit}
              isActive={false}
              isHighlighted={highlightedSection === "smartInterviewer"}
              onSelect={() => {}}
              onAddToContext={() => handleAddToContext("smartInterviewer")}
              isInContext={contextSections.includes("smartInterviewer")}
            >
              <div className="space-y-4">
                <div
                  className={`flex items-start justify-between gap-4 ${
                    !isSmartInterviewerEnabled ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex-1">
                    <p
                      className={`leading-relaxed ${
                        isSmartInterviewerEnabled
                          ? "text-gray-700"
                          : "text-gray-400"
                      }`}
                    >
                      Bridge AI will automatically generate follow-up questions
                      tailored to each candidate's code submission, probing
                      their reasoning and decision-making.
                    </p>
                  </div>
                  <Switch
                    checked={isSmartInterviewerEnabled}
                    onCheckedChange={setIsSmartInterviewerEnabled}
                    className="data-[state=checked]:bg-[#1E3A8A]"
                  />
                </div>
                {isSmartInterviewerEnabled && (
                  <div className="pt-3 border-t border-gray-100">
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      Custom Instructions (optional)
                    </label>
                    <textarea
                      value={interviewerPrompt}
                      onChange={(e) => setInterviewerPrompt(e.target.value)}
                      placeholder="E.g., Focus on system design decisions, ask about error handling strategies, probe for scalability considerations..."
                      className="w-full min-h-[80px] text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                    <p className="text-xs text-gray-400 mt-1.5">
                      Guide the AI interviewer's focus and question style
                    </p>
                  </div>
                )}
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
                        className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
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
                        className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                      />
                      <span className="text-sm text-gray-500">minutes</span>
                    </div>
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
                      className="w-16 text-center border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                    <span className="text-sm text-gray-500">days</span>
                  </div>
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
                <Link to={createPageUrl("CandidateAssessment")}>
                  <Button
                    variant="outline"
                    className="px-5 h-10 rounded-full text-sm border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Test candidate view
                  </Button>
                </Link>
                <Button
                  onClick={() => setShowPreview(true)}
                  variant="outline"
                  className="px-5 h-10 rounded-full text-sm border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview candidate view
                </Button>
                <Button
                  onClick={handleShare}
                  className="px-5 h-10 rounded-full text-sm bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] font-semibold shadow-sm hover:shadow-md hover:scale-105 transition-all"
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
              contextSections={contextSections}
              onRemoveContext={(section) =>
                setContextSections((prev) => prev.filter((s) => s !== section))
              }
              lastChange={lastChange}
              responseMessage={responseMessage}
            />
          </motion.div>
        </div>
      </div>

      {/* Preview Modal */}
      <CandidatePreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        assessment={assessment}
      />

      {/* Share Link Modal */}
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Generate Assessment Link</DialogTitle>
            <DialogDescription>
              Enter the candidate's name to generate a unique shareable link for
              this assessment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && candidateName.trim()) {
                        handleGenerateLink();
                      }
                    }}
                    autoFocus
                  />
                </div>
              </>
            ) : (
              <>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800 mb-2">
                    Link generated successfully!
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      value={generatedLink}
                      readOnly
                      className="flex-1 bg-white"
                    />
                    <Button
                      onClick={handleCopyLink}
                      size="sm"
                      variant="outline"
                      className="flex-shrink-0"
                    >
                      {linkCopied ? (
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
                <p className="text-xs text-gray-500">
                  Share this link with the candidate. They will be able to
                  access and complete the assessment.
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            {!generatedLink ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowShareModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleGenerateLink}
                  disabled={!candidateName.trim() || isGeneratingLink}
                  className="bg-[#1E3A8A] hover:bg-[#152a66]"
                >
                  {isGeneratingLink ? "Generating..." : "Generate Link"}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setShowShareModal(false);
                  setGeneratedLink("");
                  setCandidateName("");
                }}
                className="bg-[#1E3A8A] hover:bg-[#152a66]"
              >
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
