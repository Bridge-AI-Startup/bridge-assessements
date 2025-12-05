import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import PresetPills from '@/components/assessment/PresetPills';

export default function CreateAssessment() {
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const placeholderText = "Looking for a backend intern with Node + Postgres experience to build internal APIs…";

  const handleGenerate = async () => {
    setIsGenerating(true);
    // Simulate brief loading then navigate
    await new Promise(resolve => setTimeout(resolve, 1000));
    window.location.href = createPageUrl('AssessmentEditor');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
            Drop in a job description — Bridge creates the take-home project, generates AI interview questions, and scores submissions for you.
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
              <PresetPills onSelect={handlePresetSelect} selectedPreset={description} />
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
              Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">Enter</kbd> to generate · <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">Shift+Enter</kbd> for new line
            </p>
          </div>

          {/* Action Bar */}
          <div className="px-6 md:px-8 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
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
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                      >.</motion.span>
                      <motion.span
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                      >.</motion.span>
                      <motion.span
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                      >.</motion.span>
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