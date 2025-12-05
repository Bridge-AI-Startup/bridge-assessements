import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CandidatePreviewModal({ isOpen, onClose, assessment }) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between z-10">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FileText className="w-4 h-4" />
              Candidate View Preview
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Company Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-[#1E3A8A] flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-xl">B</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Technical Assessment
              </h1>
              <p className="text-gray-500">
                Complete this take-home project to continue your application
              </p>
            </div>

            {/* Time Estimate */}
            <div className="flex items-center justify-center gap-2 mb-8 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>Estimated time: 2-4 hours</span>
            </div>

            {/* Project Description */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Project Overview
              </h2>
              <p className="text-gray-700 leading-relaxed bg-gray-50 p-4 rounded-xl">
                {assessment?.projectDescription ||
                  "Build a REST API for a task management system..."}
              </p>
            </div>

            {/* Evaluation */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                How You'll Be Evaluated
              </h2>
              <div className="flex flex-wrap gap-2">
                {(
                  assessment?.rubric || [
                    { criteria: "Code Quality" },
                    { criteria: "Problem Solving" },
                    { criteria: "Documentation" },
                  ]
                ).map((item, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-[#1E3A8A]/10 text-[#1E3A8A] text-sm rounded-lg"
                  >
                    {item.criteria}
                  </span>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="text-center pt-4 border-t border-gray-100">
              <Button className="bg-[#1E3A8A] text-white hover:bg-[#152a66] px-8 py-3 h-auto rounded-xl text-base">
                Start Assessment
              </Button>
              <p className="text-xs text-gray-400 mt-3">
                You can save your progress and return anytime
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
