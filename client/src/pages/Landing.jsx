import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowRight, X, Check, Clock } from "lucide-react";
import { createPageUrl } from "@/utils";
import PresetPills from "@/components/assessment/PresetPills";
import AuthModal from "@/components/auth/AuthModal";
import { auth } from "@/firebase/firebase";
import bridgeLogo from "@/assets/bridge-logo.svg";

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
                window.location.href = createPageUrl("Pricing");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Pricing
            </Button>
            <Button
              onClick={() => {
                window.location.href = createPageUrl("Contact");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Contact
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

      {/* Video Demo Section */}
      <div className="bg-white py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              See Bridge in Action
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Watch how Bridge transforms job descriptions into a comprehensive
              pipeline
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-gray-900 aspect-video"
          >
            {/* Replace VIDEO_URL_HERE with your actual video URL or path */}
            {/* Option 1: YouTube/Vimeo embed */}
            <iframe
              className="absolute inset-0 w-full h-full"
              src="https://www.youtube.com/embed/VcXoKLQ14Zg?si=nh3IAQUBBI3pwOjm"
              title="Bridge Demo Video"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>

            {/* Option 2: Local video file - uncomment this and comment out iframe above */}
            {/* 
            <video
              className="w-full h-full object-contain"
              controls
              autoPlay
              muted
              loop
            >
              <source src="/videos/bridge-demo.mp4" type="video/mp4" />
              <source src="/videos/bridge-demo.webm" type="video/webm" />
              Your browser does not support the video tag.
            </video>
            */}
          </motion.div>
        </div>
      </div>

      {/* Comparison Section - Traditional Hiring vs Bridge */}
      <div className="bg-gray-50 py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 tracking-tight">
              Traditional Hiring vs Bridge
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Traditional Hiring Methods Card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="bg-white rounded-2xl shadow-lg p-8 flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-gray-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">
                  Traditional Hiring Methods
                </h3>
              </div>

              {/* Points List */}
              <ul className="space-y-6 flex-grow mb-6">
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <X className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Static assessments are outdated. Fixed question banks ignore
                    your stack, and are easy to find online.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <X className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Take-homes are slow to build, and candidates drop off
                    without teams ever knowing why.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <X className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Platforms like HackerRank and LeetCode test algorithm
                    trivia, not real engineering work.
                  </p>
                </li>
              </ul>

              {/* Divider */}
              <div className="border-t border-gray-200 my-6"></div>

              {/* Summary */}
              <p className="text-gray-600 font-medium text-center">
                Exhausting. Low-response. Luck-based.
              </p>
            </motion.div>

            {/* Bridge Card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white rounded-2xl shadow-lg p-8 flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-lg bg-[#1E3A8A] flex items-center justify-center overflow-hidden">
                  <img
                    src="/bridge-logo.svg"
                    alt="Bridge"
                    className="w-7 h-7 object-contain"
                  />
                </div>
                <h3 className="text-2xl font-bold text-[#1E3A8A]">Bridge</h3>
              </div>

              {/* Points List */}
              <ul className="space-y-6 flex-grow mb-6">
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Check className="w-5 h-5 text-[#1E3A8A]" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Bridge replaces fixed question banks with dynamic,
                    role-specific projects tailored to your stack.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Check className="w-5 h-5 text-[#1E3A8A]" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Bridge automates take-homes and captures why candidates opt
                    out.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Check className="w-5 h-5 text-[#1E3A8A]" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">
                    Bridge tests real engineering through projects and AI-led
                    technical interviews.
                  </p>
                </li>
              </ul>

              {/* Divider */}
              <div className="border-t border-gray-200 my-6"></div>

              {/* Summary */}
              <p className="text-[#1E3A8A] font-medium text-center">
                Automatic. High-response. Skill-based.
              </p>
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
