import { useState } from "react";
import { motion } from "framer-motion";
import { Monitor, Shield, Eye, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConsentScreen({ onConsent, onDecline }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-xl p-8"
    >
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">
          Screen Recording Consent
        </h2>
        <p className="text-sm text-gray-500 mt-2">
          This assessment includes optional screen recording to verify your
          work.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex items-start gap-3">
          <Eye className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            Periodic screenshots are captured every few seconds during the
            assessment — not continuous video.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            Only your shared screen is captured. Your camera and microphone are
            never accessed.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Monitor className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            You choose which screen(s) to share. You can stop sharing at any
            time.
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
          I consent to screen recording during this assessment
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
