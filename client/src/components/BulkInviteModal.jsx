import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, AlertTriangle, CheckCircle, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { bulkGenerateLinks, sendInvites } from "@/api/submission";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLikelyHeaderRow(name, email) {
  const nameLower = name.toLowerCase().trim();
  const emailLower = email.toLowerCase().trim();
  return (
    nameLower === "name" ||
    nameLower === "full name" ||
    nameLower === "candidate name" ||
    emailLower === "email" ||
    emailLower === "email address" ||
    emailLower === "e-mail"
  );
}

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < 2) continue;
    const name = parts[0];
    const email = parts[1];
    if (!name || !email) continue;
    if (i === 0 && isLikelyHeaderRow(name, email)) continue;
    candidates.push({ name, email });
  }

  return candidates;
}

const stepVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

export function BulkInviteContent({ assessmentId, onSuccess, onDone }) {
  const [step, setStep] = useState(1);
  const [stepDirection, setStepDirection] = useState(1);
  const [csvText, setCsvText] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [parseError, setParseError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const goToStep = (nextStep) => {
    setStepDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };

  const processFileContent = (text) => {
    setCsvText(text);
    setParseError("");
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setParseError("Please upload a CSV file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => processFileContent(e.target.result);
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleFileInputChange = (e) => handleFileUpload(e.target.files[0]);

  const handleNext = () => {
    setParseError("");
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) {
      setParseError("No valid candidates found. Make sure your CSV has name and email columns.");
      return;
    }
    setCandidates(parsed);
    goToStep(2);
  };

  const handleRemoveCandidate = (index) => {
    setCandidates((prev) => prev.filter((_, i) => i !== index));
  };

  const invalidEmailIndices = candidates
    .map((c, i) => (!EMAIL_REGEX.test(c.email) ? i : -1))
    .filter((i) => i !== -1);

  const handleImportAndSend = async () => {
    if (candidates.length === 0) return;
    setIsSending(true);
    try {
      const bulkResult = await bulkGenerateLinks(assessmentId, candidates);
      if (!bulkResult.success) {
        setParseError(bulkResult.error || "Failed to generate invite links.");
        setIsSending(false);
        return;
      }
      const submissionIds = bulkResult.data.submissions.map((s) => s.submissionId);
      const inviteResult = await sendInvites(submissionIds);
      if (!inviteResult.success) {
        setParseError(inviteResult.error || "Failed to send invite emails.");
        setIsSending(false);
        return;
      }
      setResult({ sent: inviteResult.data.sent, failed: inviteResult.data.failed });
      goToStep(3);
      if (onSuccess) onSuccess();
    } catch (err) {
      setParseError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSending(false);
    }
  };

  const StepIndicator = () => (
    <div className="flex items-center gap-2 mb-6">
      {[1, 2, 3].map((s) => (
        <React.Fragment key={s}>
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-colors ${
              s < step
                ? "bg-[#1E3A8A] text-white"
                : s === step
                ? "bg-[#1E3A8A] text-white ring-2 ring-[#1E3A8A]/30"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {s < step ? <CheckCircle className="w-3.5 h-3.5" /> : s}
          </div>
          {s < 3 && (
            <div
              className={`flex-1 h-0.5 rounded-full transition-colors ${
                s < step ? "bg-[#1E3A8A]" : "bg-gray-200"
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div>
      <StepIndicator />

      <AnimatePresence mode="wait" custom={stepDirection}>
        {step === 1 && (
          <motion.div
            key="step1"
            custom={stepDirection}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                isDragging
                  ? "border-[#1E3A8A] bg-[#1E3A8A]/5"
                  : "border-gray-200 hover:border-[#1E3A8A]/50 hover:bg-gray-50"
              }`}
            >
              <Upload className={`w-10 h-10 mx-auto mb-3 transition-colors ${isDragging ? "text-[#1E3A8A]" : "text-gray-400"}`} />
              <p className="text-sm font-medium text-gray-700 mb-1">
                {isDragging ? "Drop your CSV file here" : "Drop a CSV file here, or click to browse"}
              </p>
              <p className="text-xs text-gray-500">Accepts .csv files with name and email columns</p>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileInputChange} />
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 uppercase tracking-wider">or paste CSV</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <textarea
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setParseError(""); }}
              placeholder={"name,email\nJohn Smith,john@example.com\nJane Doe,jane@example.com"}
              rows={5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 resize-none placeholder:text-gray-400"
            />

            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs font-semibold text-gray-600 mb-1">Expected format:</p>
              <code className="text-xs text-gray-700 block whitespace-pre">{"name,email\nJohn Smith,john@example.com"}</code>
              <p className="text-xs text-gray-500 mt-1">The header row is optional and will be automatically skipped.</p>
            </div>

            {parseError && (
              <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{parseError}</p>
              </div>
            )}

            <div className="flex justify-end mt-5">
              <Button onClick={handleNext} disabled={!csvText.trim()} className="bg-[#1E3A8A] hover:bg-[#152a66] flex items-center gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step2"
            custom={stepDirection}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">
                  {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
                </span>
              </div>
              {invalidEmailIndices.length > 0 && (
                <Badge className="bg-yellow-100 text-yellow-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {invalidEmailIndices.length} invalid email{invalidEmailIndices.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden mb-4 max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {candidates.map((c, i) => {
                    const emailInvalid = !EMAIL_REGEX.test(c.email);
                    return (
                      <tr key={i} className={`transition-colors ${emailInvalid ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                        <td className="px-3 py-2 text-gray-900 font-medium">{c.name}</td>
                        <td className="px-3 py-2">
                          <span className={emailInvalid ? "text-yellow-700 font-medium" : "text-gray-600"}>
                            {c.email}
                            {emailInvalid && <AlertTriangle className="w-3 h-3 inline ml-1 text-yellow-500" />}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => handleRemoveCandidate(i)} className="text-gray-400 hover:text-red-500 transition-colors rounded p-0.5" title="Remove">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {parseError && (
              <div className="mb-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{parseError}</p>
              </div>
            )}

            <div className="flex justify-between mt-5">
              <Button variant="outline" onClick={() => { setParseError(""); goToStep(1); }} disabled={isSending}>Back</Button>
              <Button onClick={handleImportAndSend} disabled={isSending || candidates.length === 0} className="bg-[#1E3A8A] hover:bg-[#152a66] min-w-[140px]">
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : "Import & Send"}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="step3"
            custom={stepDirection}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="py-4"
          >
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              {result && (
                <>
                  {result.failed === 0 ? (
                    <p className="text-lg font-semibold text-gray-900 mb-1">
                      Invites sent to {result.sent} candidate{result.sent !== 1 ? "s" : ""}
                    </p>
                  ) : (
                    <p className="text-lg font-semibold text-gray-900 mb-1">
                      {result.sent} sent, {result.failed} failed
                    </p>
                  )}
                  <p className="text-sm text-gray-500">
                    {result.failed === 0
                      ? "All candidates have been emailed their assessment links."
                      : "Some invites could not be delivered."}
                  </p>
                </>
              )}
              <div className="flex justify-center mt-6">
                <Button onClick={onDone} className="bg-[#1E3A8A] hover:bg-[#152a66]">Close</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function BulkInviteModal({ isOpen, onClose, assessmentId, onSuccess }) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#1E3A8A]" />
            Import Candidates
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file or paste candidate data to bulk invite candidates.
          </DialogDescription>
        </DialogHeader>
        <BulkInviteContent assessmentId={assessmentId} onSuccess={onSuccess} onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}
