import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const quickActions = [
  "Make easier",
  "Make harder",
  "Add frontend component",
  "Add database component",
  "Add test cases",
  "Shorten scope",
  "Generate follow-up questions",
  "Rewrite for interns"
];

export default function ChatInput({ onSubmit, isLoading }) {
  const [message, setMessage] = useState('');

  const handleSubmit = () => {
    if (!message.trim() || isLoading) return;
    onSubmit(message);
    setMessage('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChipClick = (action) => {
    setMessage(action);
  };

  return (
    <div className="w-full">
      <div className="bg-white rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden">
        {/* Quick Action Chips */}
        <div className="px-5 pt-4 pb-2 flex flex-wrap gap-2">
          {quickActions.map((action, index) => (
            <motion.button
              key={index}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleChipClick(action)}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:border-[#1E3A8A] hover:text-[#1E3A8A] hover:bg-blue-50 transition-all duration-200 disabled:opacity-50"
            >
              {action}
            </motion.button>
          ))}
        </div>

        {/* Input Area */}
        <div className="px-5 pb-4">
          <div className="flex items-end gap-3">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell Bridge how to adjust the assessment..."
              className="flex-1 min-h-[48px] max-h-[120px] text-base leading-relaxed resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-400 p-0 bg-transparent"
            />
            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              className="bg-[#FFFF00] hover:bg-[#faed00] text-[#1E3A8A] p-2.5 h-auto rounded-xl font-semibold transition-all duration-200 shadow-sm flex-shrink-0"
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
        </div>
      </div>
    </div>
  );
}