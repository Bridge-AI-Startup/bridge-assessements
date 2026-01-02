import { motion } from "framer-motion";
import { XCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function BillingCancel() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
      >
        <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-10 h-10 text-orange-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Checkout Cancelled
        </h1>
        <p className="text-gray-600 mb-6">
          You cancelled the checkout process. No charges were made. You can
          upgrade your subscription anytime from your account settings.
        </p>
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => navigate(createPageUrl("Subscription"))}
            variant="outline"
            className="border-[#1E3A8A] text-[#1E3A8A] hover:bg-[#1E3A8A]/5"
          >
            Try Again
          </Button>
          <Button
            onClick={() => navigate(createPageUrl("Home"))}
            className="bg-[#1E3A8A] hover:bg-[#152a66] text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

