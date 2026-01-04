import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Puzzle,
  Hourglass,
  FileWarning,
  Brain,
  CheckCircle,
  LayoutDashboard,
  Check,
  MessageSquare,
  Mail,
  Phone,
  Bug,
} from "lucide-react";
import { createPageUrl } from "@/utils";
import PresetPills from "@/components/assessment/PresetPills";
import AuthModal from "@/components/auth/AuthModal";
import { auth } from "@/firebase/firebase";
import bridgeLogo from "@/assets/bridge-logo.svg";
import { Link } from "react-router-dom";

export default function Landing() {
  const [creationMode, setCreationMode] = useState("ai"); // "ai" or "manual"
  const [description, setDescription] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualTimeLimit, setManualTimeLimit] = useState(60);
  const [starterFilesLink, setStarterFilesLink] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const textareaRef = useRef(null);

  const placeholderExamples = [
    "Looking for a backend intern with Node + Postgres experience to build internal APIs…",
    "Seeking a full-stack MERN + Langchain developer to work on MongoDB, Express, React, Node.js, and AI-powered applications…",
    "Need a senior engineer with experience in distributed systems and microservices architecture…",
    "Hiring a frontend developer skilled in TypeScript, Next.js, and modern UI frameworks…",
  ];

  // Redirect logged-in users to Home (only on initial load)
  // Don't listen for auth changes - let AuthModal handle redirects after backend verification
  useEffect(() => {
    // Check initial auth state only (for users already logged in)
    const user = auth.currentUser;
    if (user) {
      window.location.href = createPageUrl("Home");
    }
    // Don't listen for auth state changes - AuthModal will handle redirects
  }, []);

  // Animated placeholder typing effect
  useEffect(() => {
    if (description || creationMode !== "ai") {
      // Don't animate if user has typed or not in AI mode
      return;
    }

    const currentText = placeholderExamples[placeholderIndex];
    let timeout;

    if (isTyping) {
      // Typing effect
      if (animatedPlaceholder.length < currentText.length) {
        timeout = setTimeout(() => {
          setAnimatedPlaceholder(
            currentText.slice(0, animatedPlaceholder.length + 1)
          );
        }, 50); // Typing speed
      } else {
        // Finished typing, wait before deleting
        timeout = setTimeout(() => {
          setIsTyping(false);
        }, 2000); // Pause at full text
      }
    } else {
      // Deleting effect
      if (animatedPlaceholder.length > 0) {
        timeout = setTimeout(() => {
          setAnimatedPlaceholder(animatedPlaceholder.slice(0, -1));
        }, 30); // Deleting speed (faster than typing)
      } else {
        // Finished deleting, move to next example
        setPlaceholderIndex((prev) => (prev + 1) % placeholderExamples.length);
        setIsTyping(true);
      }
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [
    animatedPlaceholder,
    isTyping,
    placeholderIndex,
    description,
    creationMode,
  ]);

  const placeholderText =
    description || creationMode !== "ai"
      ? placeholderExamples[0]
      : animatedPlaceholder;

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get accurate scrollHeight
      textarea.style.height = "auto";
      // Calculate new height with minimum
      const minHeight = 180; // Minimum height in pixels
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.max(minHeight, scrollHeight);
      // Set the height
      textarea.style.height = `${newHeight}px`;
      // Ensure min-height is also set via style to prevent shrinking
      textarea.style.minHeight = `${minHeight}px`;
    }
  };

  // Initialize and adjust textarea height on mount
  useEffect(() => {
    adjustTextareaHeight();
  }, []);

  // Adjust textarea height when description changes or mode changes
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      adjustTextareaHeight();
    }, 0);
    return () => clearTimeout(timer);
  }, [description, creationMode]);

  const handleGenerate = async () => {
    // Check if user is authenticated
    const user = auth.currentUser;

    // Save creation mode to localStorage
    localStorage.setItem("pending_creation_mode", creationMode);

    if (creationMode === "ai") {
      // AI Mode - save description
      if (description.trim()) {
        localStorage.setItem("pending_job_description", description.trim());
      }
    } else {
      // Manual Mode - save manual fields
      if (manualTitle.trim()) {
        localStorage.setItem("pending_manual_title", manualTitle.trim());
      }
      if (manualDescription.trim()) {
        localStorage.setItem(
          "pending_manual_description",
          manualDescription.trim()
        );
      }
      localStorage.setItem(
        "pending_manual_timeLimit",
        manualTimeLimit.toString()
      );
      if (starterFilesLink.trim()) {
        localStorage.setItem(
          "pending_starter_files_link",
          starterFilesLink.trim()
        );
      }
    }

    if (user) {
      // User is already signed in, go directly to CreateAssessment
      window.location.href = createPageUrl("CreateAssessment");
    } else {
      // User is not authenticated, redirect to sign up
      window.location.href = createPageUrl("GetStarted");
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
    <div className="min-h-screen bg-white">
      {/* Floating Pill Navigation */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="bg-white/80 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 px-4 py-2 flex items-center justify-between gap-12">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
              <img
                src={bridgeLogo}
                alt="Bridge"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-semibold text-gray-900 text-sm">Bridge</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                const pricingSection = document.getElementById("pricing");
                if (pricingSection) {
                  pricingSection.scrollIntoView({ behavior: "smooth" });
                }
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Pricing
            </Button>
            <Button
              onClick={() => {
                // Check if user is already signed in
                const user = auth.currentUser;
                if (user) {
                  // User is already signed in, redirect to Home
                  window.location.href = createPageUrl("Home");
                } else {
                  // User is not signed in, show sign-in modal
                  setShowAuthModal(true);
                }
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign In
            </Button>
            <Button
              onClick={() => {
                window.location.href = createPageUrl("GetStarted");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign Up
            </Button>
            <Button
              onClick={() =>
                window.open(
                  "https://calendly.com/smahadkar-ucsd/30min",
                  "_blank"
                )
              }
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Book a Demo
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
              Drop in a job description. Bridge creates a custom take-home,
              interviews completed submissions, and shows you why candidates
              dropped out
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
                        ref={textareaRef}
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value);
                          // Use setTimeout to ensure DOM has updated
                          setTimeout(() => adjustTextareaHeight(), 0);
                        }}
                        onKeyDown={handleKeyDown}
                        onFocus={(e) => {
                          // Ensure height is maintained on focus - prevent shrinking
                          const textarea = e.target;
                          const currentHeight = textarea.offsetHeight;
                          const minHeight = 180;
                          if (currentHeight < minHeight) {
                            textarea.style.height = `${minHeight}px`;
                            textarea.style.minHeight = `${minHeight}px`;
                          }
                          adjustTextareaHeight();
                        }}
                        onInput={adjustTextareaHeight}
                        placeholder={placeholderText}
                        className="w-full text-base md:text-lg leading-relaxed resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-400 p-0"
                        style={{ minHeight: "180px", height: "180px" }}
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
            </div>

            {/* Action Bar */}
            <div className="px-6 md:px-8 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end">
              <Button
                onClick={handleGenerate}
                disabled={
                  isGenerating ||
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

      {/* Section 2 - Three-Card Comparison Grid */}
      <div className="bg-white max-w-6xl mx-auto px-6 py-16 md:py-24">
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
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                <Puzzle className="w-6 h-6 text-orange-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 pt-2">
                Coding puzzles miss the point.
              </h3>
            </div>
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
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                <FileWarning className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 pt-2">
                Static assessments are outdated.
              </h3>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Legacy platforms rely on fixed question banks that ignore your
              stack, your requirements, and modern tools. Candidates can often
              find the answers online.{" "}
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
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Hourglass className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 pt-2">
                Take-homes are slow to build, candidates drop off
              </h3>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Teams spend hours creating and reviewing take-homes, while
              candidates drop off and teams never know why.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Section 3 - How Bridge Works */}
      <div className="bg-gradient-to-b from-gray-50 via-white to-gray-50 py-20 md:py-32 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-0 w-96 h-96 bg-[#FFFF00]/5 rounded-full blur-3xl -translate-x-1/2"></div>
          <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-blue-100/30 rounded-full blur-3xl translate-x-1/2"></div>
        </div>

        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
              How Bridge Works
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              A streamlined process that transforms how you evaluate technical
              talent
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Feature 1 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 group"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-100 to-yellow-200 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <Brain className="w-8 h-8 text-[#1E3A8A]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 pt-2">
                  Custom Role-Specific Take-Homes
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed text-[15px]">
                Paste in a job description. Bridge generates a practical project
                aligned to your actual stack and requirements, not generic
                puzzle-solving.
              </p>
            </motion.div>

            {/* Feature 2 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 group"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <MessageSquare className="w-8 h-8 text-[#1E3A8A]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 pt-2">
                  AI Follow-Up Interview Based on the Candidate's Code
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed text-[15px]">
                Bridge conducts a dynamic follow-up interview that probes a
                candidate's reasoning, tradeoffs, and understanding of their own
                implementation.
              </p>
            </motion.div>

            {/* Feature 3 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 group"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <CheckCircle className="w-8 h-8 text-[#1E3A8A]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 pt-2">
                  Understand Why Candidates Drop Off
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed text-[15px]">
                Bridge collects data on why candidates opt out, including their
                reasons and feedback. See exactly where and why candidates drop
                off in your process.
              </p>
            </motion.div>

            {/* Feature 4 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 group"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <LayoutDashboard className="w-8 h-8 text-[#1E3A8A]" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 pt-2">
                  Send with a Link. Manage Everything in One Dashboard.
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed text-[15px]">
                No infrastructure. No email back-and-forth. Just one link and a
                dashboard that handles it all.
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div
        id="pricing"
        className="bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] py-16 md:py-24"
      >
        <div className="max-w-6xl mx-auto px-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Choose Your Plan
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Start with our free tier to evaluate candidates, then upgrade for
              unlimited access.
            </p>
          </motion.div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: "Free",
                subtitle: "Evaluation Access",
                price: "$0",
                period: "forever",
                color: "blue",
                description: "Full access. Evaluate up to 3 candidates.",
                features: [
                  "1 assessment",
                  "Up to 3 candidate submissions total",
                  "Full AI follow-up interview",
                  "Assessment drop off analytics",
                ],
                cta: "Current Plan",
                ctaVariant: "outline",
                popular: false,
              },
              {
                name: "Early Access",
                subtitle: "Unlimited",
                price: "$49",
                period: "month",
                color: "green",
                description: "Unlimited candidates. Run your hiring on Bridge.",
                features: [
                  "Unlimited submissions",
                  "Unlimited assessments",
                  "Full AI follow-up interview",
                  "Assessment drop off analytics",
                ],
                cta: "Upgrade Now",
                ctaVariant: "default",
                popular: true,
              },
            ].map((tier, index) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className={`relative bg-white rounded-2xl shadow-xl overflow-hidden border-2 ${
                  tier.popular
                    ? "border-green-500 scale-105"
                    : "border-gray-200"
                }`}
              >
                {tier.popular && (
                  <div className="absolute top-0 right-0 bg-green-500 text-white px-4 py-1 text-sm font-semibold rounded-bl-lg">
                    Popular
                  </div>
                )}

                <div className="p-8">
                  {/* Tier Header */}
                  <div className="mb-6">
                    <div
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3 ${
                        tier.color === "blue"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {tier.subtitle}
                    </div>
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">
                      {tier.name}
                    </h3>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-5xl font-bold text-gray-900">
                        {tier.price}
                      </span>
                      {tier.period !== "forever" && (
                        <span className="text-gray-500">/{tier.period}</span>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm">{tier.description}</p>
                  </div>

                  {/* Features List */}
                  <ul className="space-y-3 mb-8">
                    {tier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <Check
                          className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                            tier.color === "blue"
                              ? "text-blue-600"
                              : "text-green-600"
                          }`}
                        />
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA Button */}
                  <Button
                    onClick={
                      tier.popular
                        ? () => {
                            // Check if user is logged in
                            const user = auth.currentUser;
                            if (user) {
                              window.location.href =
                                createPageUrl("Subscription");
                            } else {
                              // Store flag to redirect to subscription after signup
                              localStorage.setItem(
                                "redirect_to_subscription",
                                "true"
                              );
                              window.location.href =
                                createPageUrl("GetStarted");
                            }
                          }
                        : undefined
                    }
                    variant={tier.ctaVariant}
                    disabled={!tier.popular}
                    className={`w-full py-6 text-lg font-semibold ${
                      tier.popular
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-gray-100 text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    {tier.cta}
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Additional Info */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-12 text-center"
          >
            <p className="text-sm text-gray-500">
              All plans include full access to BridgeAI features. Upgrade
              anytime to unlock unlimited candidates.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="bg-gradient-to-b from-gray-50 to-white py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1E3A8A]/10 mb-4">
              <Bug className="w-8 h-8 text-[#1E3A8A]" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Contact Us
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Found a bug or have a question? Contact us and we'll get back to
              you as soon as possible.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12"
          >
            <div className="grid md:grid-cols-2 gap-8">
              {/* Email */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-6 h-6 text-[#1E3A8A]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Email
                  </h3>
                  <a
                    href="mailto:saaz.m@icloud.com"
                    className="text-[#1E3A8A] hover:text-[#152a66] hover:underline transition-colors"
                  >
                    saaz.m@icloud.com
                  </a>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-6 h-6 text-[#1E3A8A]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Phone
                  </h3>
                  <a
                    href="tel:+18623370989"
                    className="text-[#1E3A8A] hover:text-[#152a66] hover:underline transition-colors"
                  >
                    (862) 337-0989
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
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
            <Button
              onClick={() =>
                window.open(
                  "https://calendly.com/smahadkar-ucsd/30min",
                  "_blank"
                )
              }
              className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] px-8 py-3 h-auto rounded-xl font-semibold shadow-lg"
            >
              Book a Demo
            </Button>
          </motion.div>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
