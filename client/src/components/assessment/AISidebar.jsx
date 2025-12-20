import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, Undo, RotateCcw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const quickActions = [
  "Make easier",
  "Make harder",
  "Shorten scope",
  "Add frontend component",
  "Add database component",
  "Add test cases",
  "Rewrite for interns",
  "Generate follow-up questions",
  "Tighten rubric",
];

export default function AISidebar({
  onSubmit,
  isLoading,
  contextSections = [],
  onRemoveContext,
  lastChange,
  responseMessage,
}) {
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([
    {
      role: "assistant",
      content:
        "I've generated a backend assessment focused on Node.js and PostgreSQL. Let me know how you'd like to adjust it.",
    },
  ]);

  // Add response message to chat history when it's received
  useEffect(() => {
    if (responseMessage) {
      setChatHistory((prev) => {
        // Avoid duplicates - check if the last message is the same
        const lastMessage = prev[prev.length - 1];
        if (
          lastMessage?.role === "assistant" &&
          lastMessage?.content === responseMessage
        ) {
          return prev; // Don't add duplicate
        }
        return [...prev, { role: "assistant", content: responseMessage }];
      });
    }
  }, [responseMessage]);

  const handleSubmit = () => {
    if (!message.trim() || isLoading) return;
    setChatHistory((prev) => [...prev, { role: "user", content: message }]);
    onSubmit(message);
    setMessage("");
  };

  const handleChipClick = (action) => {
    setChatHistory((prev) => [...prev, { role: "user", content: action }]);
    onSubmit(action);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-fit sticky top-6">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-gray-900">Bridge Assistant</h3>
        </div>
        <p className="text-sm text-gray-500">
          Tell Bridge how you'd like this assessment to change.
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          <Zap className="w-3 h-3 text-green-500" />
          <span className="text-xs text-gray-400">
            Model: Bridge AI • Responds in seconds
          </span>
        </div>
      </div>

      {/* Chat History */}
      <div className="px-5 py-4 border-b border-gray-100 max-h-[300px] overflow-y-auto">
        <div className="space-y-3">
          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`text-sm p-3 rounded-xl ${
                msg.role === "assistant"
                  ? "bg-gray-50 text-gray-700"
                  : "bg-[#1E3A8A] text-white ml-4"
              }`}
            >
              {msg.content}
            </div>
          ))}
        </div>
      </div>

      {/* Context Sections */}
      {contextSections.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 bg-blue-50/50">
          <p className="text-xs text-gray-500 mb-2">Editing restricted to:</p>
          <div className="flex flex-wrap gap-1.5">
            {contextSections.map((section) => (
              <span
                key={section}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-[#1E3A8A]/20 text-[#1E3A8A] rounded-full"
              >
                {section === "projectDescription" && "Project Description"}
                {section === "rubric" && "Scoring & Rubric"}
                {section === "testCases" && "Test Cases"}
                {section === "smartInterviewer" && "Smart Interviewer"}
                <button
                  onClick={() => onRemoveContext?.(section)}
                  className="hover:text-red-500 ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-5">
        <div className="flex items-end gap-2 mb-4">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Make this harder for mid-level engineers…"
            className="flex-1 min-h-[60px] max-h-[100px] text-sm resize-none border-gray-200 focus-visible:ring-[#1E3A8A] rounded-xl"
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] p-2.5 h-auto rounded-xl shadow-sm hover:shadow-md hover:scale-105 transition-all"
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-5 h-5 border-2 border-[#1E3A8A] border-t-transparent rounded-full"
              />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </Button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-1.5">
          {quickActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleChipClick(action)}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:border-[#1E3A8A] hover:text-[#1E3A8A] hover:bg-blue-50 transition-all disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 py-4 border-t border-gray-100 bg-[#FFFF00]/10"
          >
            <div className="flex items-center gap-2 text-sm text-[#1E3A8A]">
              <Sparkles className="w-4 h-4 animate-pulse" />
              Bridge is updating your assessment…
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Last Change Summary */}
      <AnimatePresence>
        {lastChange && !isLoading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 py-4 border-t border-gray-100"
          >
            <p className="text-xs font-medium text-gray-700 mb-2">
              Updated {lastChange.section}
            </p>
            <ul className="text-xs text-gray-500 space-y-1 mb-3">
              {lastChange.changes?.map((change, i) => (
                <li key={i}>• {change}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <Undo className="w-3 h-3" /> Undo
              </button>
              <button className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <RotateCcw className="w-3 h-3" /> Apply again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
