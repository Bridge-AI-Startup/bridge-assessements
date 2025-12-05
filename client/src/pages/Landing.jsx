import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  Puzzle,
  Hourglass,
  FileWarning,
  Sparkles,
  Brain,
  CheckCircle,
  Link2,
  LayoutDashboard,
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import PresetPills from "@/components/assessment/PresetPills";
import AuthModal from "@/components/auth/AuthModal";
import { getCurrentUser, onAuthStateChange } from "@/auth";

export default function Landing() {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authDefaultTab, setAuthDefaultTab] = useState("login");

  // Redirect logged-in users to Home
  useEffect(() => {
    // Check initial auth state
    const user = getCurrentUser();
    if (user) {
      window.location.href = createPageUrl("Home");
      return;
    }

    // Listen for auth state changes (e.g., user logs in via modal)
    const unsubscribe = onAuthStateChange((user) => {
      if (user) {
        window.location.href = createPageUrl("Home");
      }
    });

    return () => unsubscribe();
  }, []);

  const placeholderText =
    "Looking for a backend intern with Node + Postgres experience to build internal APIs…";

  const handleGenerate = async () => {
    window.location.href = createPageUrl("GetStarted");
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
    <div className="min-h-screen bg-white">
      {/* Floating Pill Navigation */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="bg-white/80 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 px-4 py-2 flex items-center justify-between gap-12">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#1E3A8A] flex items-center justify-center">
              <span className="text-white font-bold text-xs">B</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Bridge</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setAuthDefaultTab("login");
                setShowAuthModal(true);
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign In
            </Button>
            <Button
              onClick={() => {
                setAuthDefaultTab("signup");
                setShowAuthModal(true);
              }}
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign Up
            </Button>
          </div>
        </nav>
      </div>

      {/* Hero Section */}
      <div className="bg-gradient-to-b from-[#dbeafe] via-[#eff6ff] to-white">
        <div className="max-w-4xl mx-auto px-6 pt-24 pb-16 md:pt-28 md:pb-24">
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
            <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed mb-6">
              Drop in a job description — Bridge creates the take-home project,
              generates AI interview questions, and scores submissions for you.
            </p>
            <Button className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] px-6 py-3 h-auto rounded-xl font-semibold shadow-sm">
              Book a Demo
            </Button>
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
            </div>

            {/* Action Bar */}
            <div className="px-6 md:px-8 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="bg-[#1E3A8A] hover:bg-[#152a66] text-white px-6 py-2.5 h-auto rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 shadow-sm"
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

      {/* Section 2 - Three-Card Comparison Grid */}
      <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Why Traditional Hiring Methods Fall Short
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Card 1 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-gray-50 rounded-2xl p-6 border border-gray-100"
          >
            <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
              <Puzzle className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Coding Puzzles Don't Test Real Engineering
            </h3>
            <p className="text-gray-600 leading-relaxed">
              HackerRank and LeetCode dont test the practical skills engineers
              use daily.
            </p>
          </motion.div>

          {/* Card 2 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-gray-50 rounded-2xl p-6 border border-gray-100"
          >
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4">
              <FileWarning className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Static Assessments Don't Adapt to Your Role
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Legacy platforms rely on fixed question banks. Nothing adapts to
              your role, your stack, or new technology.
            </p>
          </motion.div>

          {/* Card 3 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-gray-50 rounded-2xl p-6 border border-gray-100"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
              <Hourglass className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Take-homes Are Slow to Build and Review
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Teams waste hours creating and reviewing take-homes, and
              candidates drop out from long, inconsistent processes.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Section 3 - How Bridge Works */}
      <div className="bg-gray-50 py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              How Bridge Works
            </h2>
          </motion.div>

          <div className="space-y-4">
            {/* Feature 1 */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex gap-5"
            >
              <div className="w-12 h-12 rounded-xl bg-[#FFFF00]/30 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-[#1E3A8A]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Custom Role-Specific Take-Homes
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Paste in a job description. Bridge generates a practical
                  project aligned to your actual stack and requirements — not
                  generic puzzle-solving.
                </p>
              </div>
            </motion.div>

            {/* Feature 2 */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex gap-5"
            >
              <div className="w-12 h-12 rounded-xl bg-[#FFFF00]/30 flex items-center justify-center flex-shrink-0">
                <Brain className="w-6 h-6 text-[#1E3A8A]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  AI Follow-Up Interview Based on the Candidate's Code
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Bridge creates dynamic follow-up questions that probe a
                  candidate's reasoning, tradeoffs, and understanding of their
                  own implementation.
                </p>
              </div>
            </motion.div>

            {/* Feature 3 */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex gap-5"
            >
              <div className="w-12 h-12 rounded-xl bg-[#FFFF00]/30 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-[#1E3A8A]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Automated Scoring & Structured Evaluation
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Bridge grades submissions consistently, scoring code quality,
                  architecture, completeness, and decision-making.
                </p>
              </div>
            </motion.div>

            {/* Feature 4 */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex gap-5"
            >
              <div className="w-12 h-12 rounded-xl bg-[#FFFF00]/30 flex items-center justify-center flex-shrink-0">
                <LayoutDashboard className="w-6 h-6 text-[#1E3A8A]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Send with a Link. Manage Everything in One Dashboard.
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  No infrastructure, no manual grading, no complexity. Just a
                  simple link and a dashboard that handles everything.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-[#1E3A8A] py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to Transform Your Hiring Process?
            </h2>
            <p className="text-blue-200 text-lg mb-8 max-w-2xl mx-auto">
              Join teams who've replaced outdated assessments with Bridge's
              AI-powered evaluation pipeline.
            </p>
            <Button className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] px-8 py-3 h-auto rounded-xl font-semibold shadow-lg">
              Book a Demo
            </Button>
          </motion.div>
        </div>
      </div>
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        defaultTab={authDefaultTab}
        showTabs={false}
        signupRedirect={authDefaultTab === "signup" ? "Home" : "GetStarted"}
      />
    </div>
  );
}
