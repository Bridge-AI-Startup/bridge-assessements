import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, AlertCircle, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import PresetPills from "@/components/assessment/PresetPills";
import { createAssessment, generateAssessmentData } from "@/api/assessment";
import { auth } from "@/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function CreateAssessment() {
  const [description, setDescription] = useState("");
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
        window.location.href = createPageUrl("Landing");
        return;
      }
    });

    return () => unsubscribe();
  }, []);

  const placeholderText =
    "Looking for a backend intern with Node + Postgres experience to build internal APIs…";

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError("Please enter a job description");
      return;
    }

    // Ensure user is authenticated before proceeding
    if (!currentUser || !authReady) {
      setError("Please wait for authentication to complete");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      console.log("🔄 [CreateAssessment] Generating assessment data...");
      console.log("   Description:", description);
      console.log("   Current User:", currentUser?.email);

      // Get token from current user
      const token = await currentUser.getIdToken();
      console.log("   Token obtained:", token ? "✅" : "❌");

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
        console.error("❌ [CreateAssessment] Generation error:", errorMsg);
        setError(errorMsg);
        setIsGenerating(false);
        return;
      }

      const {
        title,
        description: generatedDescription,
        timeLimit,
        scoring,
      } = generateResult.data;
      console.log("   Generated Title:", title);
      console.log(
        "   Generated Description:",
        generatedDescription.substring(0, 100) + "..."
      );
      console.log("   Time Limit:", timeLimit, "minutes");
      console.log("   Generated Scoring:", scoring);

      // Create assessment with generated data (use AI-generated description, not user input)
      const result = await createAssessment(
        {
          title: title,
          description: generatedDescription,
          timeLimit: timeLimit,
          scoring: scoring,
        },
        token
      );

      if (!result.success) {
        const errorMsg =
          "error" in result ? result.error : "Failed to create assessment";
        console.error("❌ [CreateAssessment] Error:", errorMsg);
        setError(errorMsg);
        setIsGenerating(false);
        return;
      }

      console.log(
        "✅ [CreateAssessment] Assessment created successfully:",
        result.data
      );

      // Redirect to assessment editor with the new assessment ID
      const assessmentId = result.data._id;
      window.location.href =
        createPageUrl("AssessmentEditor") + `?id=${assessmentId}`;
    } catch (err) {
      console.error("❌ [CreateAssessment] Unexpected error:", err);
      setError(
        err.message || "An unexpected error occurred. Please try again."
      );
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
            Drop in a job description, Bridge creates the take-home project,
            generates AI interview questions, and scores submissions for you.
          </p>
        </motion.div>

        {/* Main Input Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.06)] border border-gray-100 overflow-hidden"
        >
          <div className="p-6 md:p-8">
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

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mt-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className="px-6 md:px-8 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end">
            <Button
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                !description.trim() ||
                !authReady ||
                !currentUser
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
                    Generate with AI
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
