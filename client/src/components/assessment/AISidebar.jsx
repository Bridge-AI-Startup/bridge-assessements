import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sectionLabel } from "@/components/assessment/sections";

/**
 * Chips are shortcuts for things the assistant can actually do. Every one of
 * these maps onto a section it is allowed to write (description, time limit,
 * product checks, evaluation criteria) — the previous set advertised test cases
 * and "follow-up questions", neither of which the assistant could change.
 */
const quickActions = [
  "Make this harder",
  "Make this easier",
  "Shorten the scope",
  "Tighten the time limit",
  "Add a frontend requirement",
  "Add a database requirement",
  "Suggest product checks",
  "Suggest evaluation criteria",
];

export default function AISidebar({
  onSubmit,
  isLoading,
  messages = [],
  contextSections = [],
  onRemoveContext,
  lastChange,
}) {
  const [message, setMessage] = useState("");
  const scrollRef = useRef(null);

  // Keep the newest turn in view; a reply that lands below the fold reads as
  // nothing having happened.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  const handleSubmit = () => {
    if (!message.trim() || isLoading) return;
    onSubmit(message);
    setMessage("");
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
          Ask a question, or tell Bridge how this assessment should change.
        </p>
      </div>

      {/* Chat History */}
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="px-5 py-4 border-b border-gray-100 max-h-[300px] overflow-y-auto"
        >
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm p-3 rounded-xl whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#21201C] text-white ml-4"
                    : msg.error
                      ? "bg-red-50 text-red-700 border border-red-100"
                      : "bg-gray-50 text-gray-700"
                }`}
              >
                {msg.error && (
                  <AlertCircle className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
                )}
                {msg.content}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Context Sections */}
      {contextSections.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 bg-blue-50/50">
          <p className="text-xs text-gray-500 mb-2">Editing restricted to:</p>
          <div className="flex flex-wrap gap-1.5">
            {contextSections.map((section) => (
              <span
                key={section}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-[#21201C]/20 text-[#21201C] rounded-full"
              >
                {/* Fall back to the raw id: a pinned section the labels map
                    doesn't know still has to be readable and removable. */}
                {sectionLabel(section)}
                <button
                  onClick={() => onRemoveContext?.(section)}
                  aria-label={`Stop restricting edits to ${sectionLabel(section)}`}
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
            className="flex-1 min-h-[60px] max-h-[100px] text-sm resize-none border-gray-200 focus-visible:ring-[#21201C] rounded-xl"
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !message.trim()}
            className="bg-[#21201C] hover:bg-[#35332D] text-[#FAF9F2] p-2.5 h-auto rounded-full shadow-sm hover:shadow-md hover:scale-105 transition-all"
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-5 h-5 border-2 border-[#FAF9F2] border-t-transparent rounded-full"
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
              onClick={() => onSubmit(action)}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:border-[#21201C] hover:text-[#21201C] hover:bg-blue-50 transition-all disabled:opacity-50"
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
            className="px-5 py-4 border-t border-gray-100 bg-[#F0D294]/20"
          >
            <div className="flex items-center gap-2 text-sm text-[#21201C]">
              <Sparkles className="w-4 h-4 animate-pulse" />
              Bridge is working on your assessment…
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
            <ul className="text-xs text-gray-500 space-y-1">
              {lastChange.changes?.map((change, i) => (
                <li key={i}>• {change}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
