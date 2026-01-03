import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getBillingStatus } from "@/api/billing";
import { auth } from "@/firebase/firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function BillingSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/");
        return;
      }

      // Refetch billing status to update subscription state
      try {
        const token = await user.getIdToken();
        const result = await getBillingStatus(token);

        if (result.success) {
          console.log(
            "✅ [BillingSuccess] Subscription status updated:",
            result.data
          );
        } else {
          console.error(
            "❌ [BillingSuccess] Failed to fetch billing status:",
            result.error
          );
          setError("Failed to verify subscription. Please check your account.");
        }
      } catch (err) {
        console.error("❌ [BillingSuccess] Error:", err);
        setError("An error occurred while verifying your subscription.");
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Verifying your subscription...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
      >
        {error ? (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-2xl">⚠️</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Verification Error
            </h1>
            <p className="text-gray-600 mb-6">{error}</p>
            <Button
              onClick={() => navigate(createPageUrl("Subscription"))}
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white"
            >
              Go to Subscription
            </Button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Subscription Activated!
            </h1>
            <p className="text-gray-600 mb-6">
              Thank you for subscribing. Your account has been upgraded and you
              now have access to all premium features.
            </p>
            {sessionId && (
              <p className="text-xs text-gray-400 mb-6">
                Session ID: {sessionId.substring(0, 20)}...
              </p>
            )}
            <Button
              onClick={() => navigate(createPageUrl("Home"))}
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </>
        )}
      </motion.div>
    </div>
  );
}
