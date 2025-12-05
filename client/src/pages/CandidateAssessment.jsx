import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  FileText,
  Code,
  Calendar,
  AlertCircle,
  Play,
  Upload,
  Link as LinkIcon,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function CandidateAssessment() {
  const [hasStarted, setHasStarted] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [notes, setNotes] = useState("");

  // Mock assessment data
  const assessment = {
    companyName: "Bridge",
    companyLogo: "B",
    title: "Backend API Assessment",
    projectDescription:
      "Build a simple REST API for a task management system. The candidate will create endpoints for CRUD operations on tasks and users, implement database relationships, and add basic authentication. This project tests practical backend skills in a realistic scenario.",
    rubric: [
      { criteria: "Code Quality", weight: "25%" },
      { criteria: "API Design", weight: "25%" },
      { criteria: "Database Modeling", weight: "20%" },
      { criteria: "Testing", weight: "15%" },
      { criteria: "Documentation", weight: "15%" },
    ],
    timeLimit: "4 hours",
    deadline: "7 days",
  };

  const handleStart = () => {
    setHasStarted(true);
  };

  const handleSubmit = () => {
    alert("Assessment submitted successfully!");
  };

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#1E3A8A] px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4">
              <span className="text-[#1E3A8A] font-bold text-2xl">
                {assessment.companyLogo}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {assessment.title}
            </h1>
            <p className="text-blue-200">from {assessment.companyName}</p>
          </div>

          {/* Content */}
          <div className="p-8">
            {/* Time Info */}
            <div className="flex items-center justify-center gap-6 mb-8 py-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-5 h-5 text-[#1E3A8A]" />
                <span className="text-sm">
                  <strong>{assessment.timeLimit}</strong> to complete
                </span>
              </div>
              <div className="w-px h-6 bg-gray-300" />
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="w-5 h-5 text-[#1E3A8A]" />
                <span className="text-sm">
                  <strong>{assessment.deadline}</strong> to start
                </span>
              </div>
            </div>

            {/* Project Overview */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#1E3A8A]" />
                Project Overview
              </h2>
              <p className="text-gray-700 leading-relaxed bg-gray-50 p-4 rounded-xl">
                {assessment.projectDescription}
              </p>
            </div>

            {/* Evaluation Criteria */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Code className="w-5 h-5 text-[#1E3A8A]" />
                How You'll Be Evaluated
              </h2>
              <div className="flex flex-wrap gap-2">
                {assessment.rubric.map((item, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-[#1E3A8A]/10 text-[#1E3A8A] text-sm rounded-lg"
                  >
                    {item.criteria} ({item.weight})
                  </span>
                ))}
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-6">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <strong>Important:</strong> Once you start, the timer begins.
                You'll have {assessment.timeLimit} to complete and submit your
                work. Make sure you're ready before clicking Start.
              </div>
            </div>

            {/* Start Button */}
            <Button
              onClick={handleStart}
              className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-6 text-lg rounded-xl"
            >
              <Play className="w-5 h-5 mr-2" />
              Start Assessment
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Started state - show submission form
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1E3A8A] flex items-center justify-center">
              <span className="text-white font-bold">
                {assessment.companyLogo}
              </span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                {assessment.title}
              </h1>
              <p className="text-xs text-gray-500">{assessment.companyName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg">
            <Clock className="w-4 h-4" />
            <span className="font-mono font-semibold">3:42:15</span>
            <span className="text-sm">remaining</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Left - Instructions */}
          <div className="md:col-span-2 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Project Instructions
              </h2>
              <p className="text-gray-700 leading-relaxed">
                {assessment.projectDescription}
              </p>
            </motion.div>

            {/* Submission Form */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Submit Your Work
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    GitHub Repository URL *
                  </label>
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      className="pl-10"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Additional Notes (optional)
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional context about your approach, trade-offs made, or things you'd improve with more time..."
                    className="min-h-[100px]"
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={!githubUrl}
                  className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit Assessment
                </Button>
              </div>
            </motion.div>
          </div>

          {/* Right - Sidebar */}
          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <h3 className="font-medium text-gray-900 mb-3">
                Evaluation Criteria
              </h3>
              <ul className="space-y-2">
                {assessment.rubric.map((item, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-700">{item.criteria}</span>
                    <span className="text-gray-400">{item.weight}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-blue-50 rounded-xl border border-blue-100 p-5"
            >
              <h3 className="font-medium text-[#1E3A8A] mb-2">Need Help?</h3>
              <p className="text-sm text-gray-600">
                If you encounter any technical issues, contact support@bridge.ai
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
