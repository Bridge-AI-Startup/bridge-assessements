import { useState } from "react";
import { motion } from "framer-motion";
import { Monitor, Shield, Eye, Mic, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMPANION_ENABLED } from "@/config/companion";

/**
 * `evidenceMode` matters here: in "both" the screen is recorded AND the
 * candidate's AI conversation and code changes are captured by the capture kit.
 * Describing only the screen would understate the more invasive of the two.
 */
export default function ConsentScreen({ onConsent, onDecline, evidenceMode = "screen" }) {
  const alsoCapturesWorkflow = evidenceMode === "both";
  const [agreed, setAgreed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg mx-auto bg-white rounded-card border border-border shadow-[0_2px_18px_rgba(33,32,28,0.06)] p-8"
    >
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-xl font-medium tracking-[-0.012em] text-gray-900">
          {COMPANION_ENABLED
            ? "Screen & Voice Recording Consent"
            : "Screen Recording Consent"}
        </h2>
        <p className="text-sm text-gray-500 mt-2">
          {COMPANION_ENABLED
            ? "This assessment includes optional screen recording and a voice check-in to capture how you work."
            : "This assessment includes optional screen recording to verify your work."}
        </p>
        {alsoCapturesWorkflow && (
          <p className="text-sm text-gray-700 mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left">
            This assessment <strong>also records your AI assistant
            conversation</strong> — the prompts you write, the replies, the
            commands run on your behalf, and the code you change in the project
            folder. That is set up separately by a command shown on the next
            screen, which discloses it again before anything is captured.
          </p>
        )}
      </div>

      <div
        className="flex items-start gap-3 p-4 mb-6 rounded-xl border border-amber-200 bg-amber-50 text-left"
        role="status"
      >
        <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-950">
          <p className="font-semibold text-amber-950 mb-1">Eligibility</p>
          <p>
            In the next step your browser will ask what to share. To remain
            eligible for official scoring, choose{" "}
            <strong className="font-semibold">Entire Screen</strong> (your full
            display). Sharing only a single app window or a browser tab may make
            your attempt ineligible.
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-start gap-3">
          <Eye className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            Your shared screen is recorded continuously for the duration of the
            assessment.
          </p>
        </div>
        {COMPANION_ENABLED && (
          <div className="flex items-start gap-3">
            <Mic className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-600">
              A voice check-in listens while you talk through your thinking, so
              your reasoning is captured alongside your code. It never gives
              hints or answers, and you can mute it at any time.
            </p>
          </div>
        )}
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            {COMPANION_ENABLED
              ? "Only your shared screen and your microphone are captured. Your camera is never accessed."
              : "Only your shared screen is captured. Your camera and microphone are never accessed."}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Monitor className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            You can add more than one display if you use multiple monitors. You
            can stop sharing at any time.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700">
          {COMPANION_ENABLED
            ? "I consent to screen and voice recording during this assessment"
            : "I consent to screen recording during this assessment"}
        </span>
      </label>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onDecline} className="flex-1">
          <XCircle className="w-4 h-4 mr-2" />
          Skip Recording
        </Button>
        <Button
          onClick={onConsent}
          disabled={!agreed}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <CheckCircle className="w-4 h-4 mr-2" />
          Continue with Recording
        </Button>
      </div>
    </motion.div>
  );
}
