import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { RefreshCw, Check, FileText, ListChecks, Target } from 'lucide-react';

export default function AssessmentResult({ result, onRegenerate, onUse, isRegenerating }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-3xl mx-auto mt-8"
    >
      <div className="bg-white rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.06)] border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FFFF00] flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#1E3A8A]" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">Suggested take-home project</h3>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6 space-y-8">
          {/* Project Summary */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A]" />
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Project Summary</h4>
            </div>
            <p className="text-gray-700 leading-relaxed">
              {result.summary}
            </p>
          </div>

          {/* Requirements */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A]" />
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Requirements</h4>
            </div>
            <ul className="space-y-3">
              {result.requirements.map((req, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <ListChecks className="w-3 h-3 text-[#1E3A8A]" />
                  </div>
                  <span className="text-gray-700">{req}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Evaluation Criteria */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A]" />
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide">What you'll evaluate</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {result.evaluationCriteria.map((criteria, index) => (
                <span
                  key={index}
                  className="px-3 py-1.5 bg-gray-50 text-gray-700 text-sm rounded-lg border border-gray-100"
                >
                  {criteria}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-8 py-5 bg-gray-50/50 border-t border-gray-100 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="text-gray-600 hover:text-[#1E3A8A] hover:bg-gray-100"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </Button>
          <Button
            variant="outline"
            onClick={onUse}
            className="border-[#1E3A8A] text-[#1E3A8A] hover:bg-[#1E3A8A] hover:text-white transition-colors"
          >
            <Check className="w-4 h-4 mr-2" />
            Use this assessment
          </Button>
        </div>
      </div>
    </motion.div>
  );
}