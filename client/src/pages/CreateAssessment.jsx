import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowRight, AlertCircle, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import PresetPills from "@/components/assessment/PresetPills";
import { createAssessment, generateAssessmentData } from "@/api/assessment";
import { auth } from "@/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function CreateAssessment() {
  const [creationMode, setCreationMode] = useState("ai"); // "ai" or "manual"
  const [description, setDescription] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualTimeLimit, setManualTimeLimit] = useState(60);
  const [starterFilesLink, setStarterFilesLink] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log(
        "🔄 [CreateAssessment] Auth state changed, user:",
        user?.email
      );
      setCurrentUser(user);
      setAuthReady(true);

      if (!user) {
        console.warn(
          "⚠️ [CreateAssessment] No user found, redirecting to landing"
        );
        window.location.href = "/";
        return;
      }

      // Check for pending creation mode from Landing page
      const pendingMode = localStorage.getItem("pending_creation_mode");
      if (pendingMode === "ai" || pendingMode === "manual") {
        console.log(
          "📝 [CreateAssessment] Found pending creation mode:",
          pendingMode
        );
        setCreationMode(pendingMode);
        localStorage.removeItem("pending_creation_mode");
      }

      // Check for pending job description from Landing page (AI mode)
      const pendingDescription = localStorage.getItem(
        "pending_job_description"
      );
      if (pendingDescription) {
        console.log(
          "📝 [CreateAssessment] Found pending job description, auto-filling..."
        );
        setDescription(pendingDescription);
        // Clear it so it doesn't auto-fill again on re-renders
        localStorage.removeItem("pending_job_description");
      }

      // Check for pending manual fields from Landing page (Manual mode)
      const pendingManualTitle = localStorage.getItem("pending_manual_title");
      const pendingManualDescription = localStorage.getItem(
        "pending_manual_description"
      );
      const pendingManualTimeLimit = localStorage.getItem(
        "pending_manual_timeLimit"
      );
      const pendingStarterFilesLink = localStorage.getItem(
        "pending_starter_files_link"
      );

      if (pendingManualTitle) {
        setManualTitle(pendingManualTitle);
        localStorage.removeItem("pending_manual_title");
      }
      if (pendingManualDescription) {
        setManualDescription(pendingManualDescription);
        localStorage.removeItem("pending_manual_description");
      }
      if (pendingManualTimeLimit) {
        const timeLimit = parseInt(pendingManualTimeLimit, 10);
        if (!isNaN(timeLimit) && timeLimit > 0) {
          setManualTimeLimit(timeLimit);
        }
        localStorage.removeItem("pending_manual_timeLimit");
      }
      if (pendingStarterFilesLink) {
        setStarterFilesLink(pendingStarterFilesLink);
        localStorage.removeItem("pending_starter_files_link");
      }
    });

    return () => unsubscribe();
  }, []);

  const placeholderText =
    "Looking for a backend intern with Node + Postgres experience to build internal APIs…";

  const handleGenerate = async () => {
    // Ensure user is authenticated before proceeding
    if (!currentUser || !authReady) {
      setError("Please wait for authentication to complete");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      const token = await currentUser.getIdToken();

      let assessmentData;

      if (creationMode === "ai") {
        // AI Generation Mode
        if (!description.trim()) {
          setError("Please enter a job description");
          setIsGenerating(false);
          return;
        }

        console.log(
          "🔄 [CreateAssessment] Generating assessment data with AI..."
        );

        // Generate assessment data from backend
        const generateResult = await generateAssessmentData(
          description.trim(),
          token
        );

        if (!generateResult.success) {
          const errorMsg =
            "error" in generateResult
              ? generateResult.error
              : "Failed to generate assessment data";
          
          console.log("🔍 [CreateAssessment] Generate error:", errorMsg, generateResult);
          
          // Check if it's a subscription limit error (multiple ways it might appear)
          const errorStr = String(errorMsg).toLowerCase();
          const errorObjStr = JSON.stringify(generateResult || {}).toLowerCase();
          
          // Check error message and full error object for subscription limit indicators
          const isSubscriptionLimit = 
            errorMsg === "SUBSCRIPTION_LIMIT_REACHED" ||
            errorStr.includes("subscription_limit_reached") ||
            errorStr.includes("free tier limit") ||
            errorStr.includes("limit") ||
            errorStr.includes("403") ||
            errorObjStr.includes("subscription_limit_reached") ||
            errorObjStr.includes("free tier limit");
          
          if (isSubscriptionLimit) {
            // Always show the error in the UI
            setError(
              "You've reached the free tier limit of 1 assessment. Upgrade to create unlimited assessments."
            );
            setIsGenerating(false);
            
            // Show a confirm dialog to offer upgrade
            const shouldUpgrade = window.confirm(
              "You've reached the free tier limit of 1 assessment.\n\n" +
              "Upgrade to create unlimited assessments.\n\n" +
              "Would you like to view subscription plans?"
            );
            if (shouldUpgrade) {
              window.location.href = createPageUrl("Subscription");
            }
            return;
          }
          
          console.error("❌ [CreateAssessment] Generation error:", errorMsg);
          // Only show clean error messages, not raw JSON
          const cleanError = errorMsg.length > 200 
            ? "Failed to generate assessment. Please try again."
            : errorMsg;
          setError(cleanError);
          setIsGenerating(false);
          return;
        }

        const {
          title,
          description: generatedDescription,
          timeLimit,
        } = generateResult.data;

        assessmentData = {
          title: title,
          description: generatedDescription,
          timeLimit: timeLimit,
        };
      } else {
        // Manual Creation Mode
        if (!manualTitle.trim()) {
          setError("Please enter an assessment title");
          setIsGenerating(false);
          return;
        }
        if (!manualDescription.trim()) {
          setError("Please enter an assessment description");
          setIsGenerating(false);
          return;
        }
        if (manualTimeLimit < 1 || manualTimeLimit > 10080) {
          setError("Time limit must be between 1 and 10080 minutes (1 week)");
          setIsGenerating(false);
          return;
        }

        console.log("🔄 [CreateAssessment] Creating assessment manually...");

        assessmentData = {
          title: manualTitle.trim(),
          description: manualDescription.trim(),
          timeLimit: manualTimeLimit,
        };
      }

      // Add starter files GitHub link if provided (only for manual mode)
      if (creationMode === "manual" && starterFilesLink.trim()) {
        assessmentData.starterFilesGitHubLink = starterFilesLink.trim();
      }

      // Create assessment
      const result = await createAssessment(assessmentData, token);

      if (!result.success) {
        const errorMsg =
          "error" in result ? result.error : "Failed to create assessment";
        
        // Check if it's a subscription limit error
        if (errorMsg === "SUBSCRIPTION_LIMIT_REACHED" || errorMsg.includes("limit")) {
          // Always show the error in the UI
          setError(
            "You've reached the free tier limit of 1 assessment. Upgrade to create unlimited assessments."
          );
          setIsGenerating(false);
          
          // Also show a confirm dialog to offer upgrade
          const shouldUpgrade = window.confirm(
            "You've reached the free tier limit of 1 assessment.\n\n" +
            "Upgrade to create unlimited assessments.\n\n" +
            "Would you like to view subscription plans?"
          );
          if (shouldUpgrade) {
            window.location.href = createPageUrl("Subscription");
          }
          return;
        }
        
        console.error("❌ [CreateAssessment] Error:", errorMsg);
        setError(errorMsg);
        setIsGenerating(false);
        return;
      }

      console.log(
        "✅ [CreateAssessment] Assessment created successfully:",
        result.data
      );

      // Clear any pending data since we've used it
      localStorage.removeItem("pending_job_description");
      localStorage.removeItem("pending_creation_mode");
      localStorage.removeItem("pending_manual_title");
      localStorage.removeItem("pending_manual_description");
      localStorage.removeItem("pending_manual_timeLimit");
      localStorage.removeItem("pending_starter_files_link");

      // Redirect to assessment editor with the new assessment ID
      const assessmentId = result.data._id;
      window.location.href =
        createPageUrl("AssessmentEditor") + `?id=${assessmentId}`;
    } catch (err) {
      console.error("❌ [CreateAssessment] Unexpected error:", err);
      
      // Check if error message contains subscription limit info
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStr = errorMessage.toLowerCase();
      
      // Check for subscription limit errors in multiple formats
      if (
        errorStr.includes("subscription_limit_reached") ||
        errorStr.includes("free tier limit") ||
        errorStr.includes("403") ||
        errorStr.includes("limit") ||
        (errorStr.includes("403") && errorStr.includes("subscription"))
      ) {
        // Handle as subscription limit error
      setError(
          "You've reached the free tier limit of 1 assessment. Upgrade to create unlimited assessments."
        );
        setIsGenerating(false);
        
        const shouldUpgrade = window.confirm(
          "You've reached the free tier limit of 1 assessment.\n\n" +
          "Upgrade to create unlimited assessments.\n\n" +
          "Would you like to view subscription plans?"
        );
        if (shouldUpgrade) {
          window.location.href = createPageUrl("Subscription");
        }
        return;
      }
      
      // For other errors, show a clean error message (not the raw error object)
      const cleanErrorMessage = errorMessage.length > 200 
        ? "An unexpected error occurred. Please try again."
        : errorMessage;
      setError(cleanErrorMessage);
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handlePresetSelect = (value) => {
    setDescription(value);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#dbeafe] via-[#eff6ff] to-white">
      <div className="max-w-4xl mx-auto px-6 py-16 md:py-24">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <Link
            to={createPageUrl("Home")}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-[#1E3A8A] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Assessments
          </Link>
        </motion.div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          {/* Heading */}
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
            Describe the role. <br /> Bridge builds the evaluation pipeline.
          </h1>

          {/* Subheading */}
          <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
            {creationMode === "ai"
              ? "Drop in a job description, Bridge creates the take-home project, generates AI interview questions, and scores submissions for you."
              : "Create your own assessment by providing the title, description, and time limit."}
          </p>
        </motion.div>

        {/* Mode Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex justify-center mb-8 gap-4"
        >
          <button
            onClick={() => setCreationMode("ai")}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${
              creationMode === "ai"
                ? "bg-[#1E3A8A] text-white shadow-md"
                : "bg-white text-gray-700 border border-gray-200 hover:border-[#1E3A8A]/30"
            }`}
          >
            Generate with AI
          </button>
          <button
            onClick={() => setCreationMode("manual")}
            className={`px-6 py-3 rounded-xl font-medium transition-all ${
              creationMode === "manual"
                ? "bg-[#1E3A8A] text-white shadow-md"
                : "bg-white text-gray-700 border border-gray-200 hover:border-[#1E3A8A]/30"
            }`}
          >
            Create Manually
          </button>
        </motion.div>

        {/* Main Input Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.06)] border border-gray-100 overflow-hidden"
        >
          <div className="p-6 md:p-8">
            <AnimatePresence mode="wait">
              {creationMode === "ai" ? (
                <motion.div
                  key="ai-mode"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Preset Pills */}
                  <div className="mb-5">
                    <PresetPills
                      onSelect={handlePresetSelect}
                      selectedPreset={description}
                    />
                  </div>

                  {/* Textarea */}
                  <div className="relative">
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={placeholderText}
                      className="w-full min-h-[180px] text-base md:text-lg leading-relaxed resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-400 p-0"
                    />
                  </div>

                  {/* Helper text */}
                  <p className="text-sm text-gray-400 mt-4">
                    Press{" "}
                    <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">
                      Enter
                    </kbd>{" "}
                    to generate ·{" "}
                    <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">
                      Shift+Enter
                    </kbd>{" "}
                    for new line
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="manual-mode"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-5"
                >
                  {/* Title Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Assessment Title
                    </label>
                    <Input
                      type="text"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      placeholder="e.g., Backend API Development Assessment"
                      className="w-full"
                    />
                  </div>

                  {/* Description Textarea */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Assessment Description
                    </label>
                    <Textarea
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      placeholder="Describe the take-home project, requirements, and what you're looking for in the candidate's submission..."
                      className="w-full min-h-[200px] text-base leading-relaxed"
                    />
                  </div>

                  {/* Time Limit Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Time Limit (minutes)
                    </label>
                    <Input
                      type="number"
                      value={manualTimeLimit}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value) && value > 0) {
                          setManualTimeLimit(value);
                        }
                      }}
                      min="1"
                      max="10080"
                      className="w-full"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Enter time limit in minutes (1-10080, max 1 week)
                    </p>
                  </div>

                  {/* Starter Files GitHub Link (only in manual mode) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Starter Files GitHub Link (Optional)
                    </label>
                    <Input
                      type="url"
                      value={starterFilesLink}
                      onChange={(e) => setStarterFilesLink(e.target.value)}
                      placeholder="https://github.com/username/repo"
                      className="w-full"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Provide a GitHub repository link with starter files and
                      instructions. Candidates will have access to this link
                      when they start the assessment.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mt-4"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium mb-1">{error}</p>
                  {error.includes("free tier limit") && (
                    <Link
                      to={createPageUrl("Subscription")}
                      className="text-red-800 hover:text-red-900 underline font-medium"
                    >
                      Upgrade to create unlimited assessments →
                    </Link>
                  )}
              </div>
              </motion.div>
            )}
          </div>

          {/* Action Bar */}
          <div className="px-6 md:px-8 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end">
            <Button
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                !authReady ||
                !currentUser ||
                (creationMode === "ai" && !description.trim()) ||
                (creationMode === "manual" &&
                  (!manualTitle.trim() ||
                    !manualDescription.trim() ||
                    manualTimeLimit < 1))
              }
              className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] px-6 py-2.5 h-auto rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 shadow-sm"
            >
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    <span>Generating</span>
                    <span className="flex gap-0.5">
                      <motion.span
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          delay: 0,
                        }}
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          delay: 0.2,
                        }}
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          delay: 0.4,
                        }}
                      >
                        .
                      </motion.span>
                    </span>
                  </motion.span>
                ) : (
                  <motion.span
                    key="default"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    {creationMode === "ai"
                      ? "Generate with AI"
                      : "Create Assessment"}
                    <ArrowRight className="w-4 h-4" />
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
