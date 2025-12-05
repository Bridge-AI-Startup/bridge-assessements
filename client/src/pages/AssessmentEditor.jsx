import React, { useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import DocumentBlock, {
  RubricItem,
  TestCaseItem,
} from "@/components/assessment/DocumentBlock";
import AISidebar from "@/components/assessment/AISidebar";
import CandidatePreviewModal from "@/components/assessment/CandidatePreviewModal";

export default function AssessmentEditor() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [highlightedSection, setHighlightedSection] = useState(null);
  const [lastChange, setLastChange] = useState(null);
  const [isSmartInterviewerEnabled, setIsSmartInterviewerEnabled] =
    useState(true);
  const [interviewerPrompt, setInterviewerPrompt] = useState("");
  const [contextSections, setContextSections] = useState([]);
  const [timeLimit, setTimeLimit] = useState({ hours: 4, minutes: 0 });
  const [startDeadline, setStartDeadline] = useState(7);

  const handleAddToContext = (section) => {
    setContextSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  };

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

  const handleChatSubmit = async (message) => {
    setIsLoading(true);

    try {
      const allowedSections =
        contextSections.length > 0
          ? contextSections
          : ["projectDescription", "rubric", "testCases"];

      const sectionRestriction =
        contextSections.length > 0
          ? `IMPORTANT: You may ONLY modify the following sections: ${contextSections
              .map((s) => {
                if (s === "projectDescription") return "Project Description";
                if (s === "rubric") return "Rubric";
                if (s === "testCases") return "Test Cases";
                return s;
              })
              .join(", ")}. Do NOT change any other sections.`
          : "You may update any sections as needed.";

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert technical hiring assistant. Based on the following instruction, update the technical assessment.

      Current Assessment:
            - Project Description: ${assessment.projectDescription}
            - Rubric: ${assessment.rubric
              .map((r) => `${r.criteria} (${r.weight})`)
              .join(", ")}
            - Test Cases: ${assessment.testCases
              .map((t) => `${t.name} (${t.type}, ${t.points}pts)`)
              .join(", ")}

      ${sectionRestriction}

      User Instruction: "${message}"

      Return a JSON object with the updated assessment. Only include fields that should change (and only from allowed sections). The structure should be:
{
  "projectDescription": "string (if changed)",
  "rubric": [{"criteria": "string", "weight": "string"} (if changed)],
  "testCases": [{"name": "string", "type": "unit|integration|e2e", "points": number} (if changed)],
  "changedSections": ["list of ALL section names that were changed: projectDescription, rubric, testCases"],
  "changesSummary": ["brief bullet points of what was changed across all sections"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            projectDescription: { type: "string" },
            rubric: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criteria: { type: "string" },
                  weight: { type: "string" },
                },
              },
            },
            testCases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  points: { type: "number" },
                },
              },
            },
            changedSections: { type: "array", items: { type: "string" } },
            changesSummary: { type: "array", items: { type: "string" } },
          },
        },
      });

      const updates = {};
      if (response.projectDescription)
        updates.projectDescription = response.projectDescription;
      if (response.rubric?.length) updates.rubric = response.rubric;
      if (response.testCases?.length) updates.testCases = response.testCases;

      setAssessment((prev) => ({ ...prev, ...updates }));

      if (response.changedSections?.length) {
        // Highlight all changed sections
        response.changedSections.forEach((section, index) => {
          setTimeout(() => {
            setHighlightedSection(section);
            setTimeout(() => setHighlightedSection(null), 2000);
          }, index * 500);
        });

        setLastChange({
          section:
            response.changedSections.length > 1
              ? `${response.changedSections.length} sections`
              : response.changedSections[0],
          changes: response.changesSummary || [],
        });
      }
    } catch (error) {
      console.error("Error updating assessment:", error);
    }

    setIsLoading(false);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Assessment link copied to clipboard!");
  };

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
            <h1 className="text-2xl font-bold text-[#1E3A8A]">
              Assessment Editor
            </h1>
            <p className="text-gray-500 text-sm">
              Use Bridge AI to shape your technical assessment — tweak scope,
              difficulty, and structure in one place.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-white px-3 py-2 rounded-lg border border-gray-200">
            <Clock className="w-3.5 h-3.5" />
            <span>Draft saved • Last updated 2 min ago</span>
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
              onEdit={(value) =>
                setAssessment((prev) => ({
                  ...prev,
                  projectDescription: value,
                }))
              }
            >
              <p className="text-gray-700 leading-relaxed">
                {assessment.projectDescription}
              </p>
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
                <Link to={createPageUrl("SubmissionsDashboard")}>
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
    </div>
  );
}
