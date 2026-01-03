import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { cancelSubscription } from "@/api/billing";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CANCELLATION_REASONS = [
  "Too expensive",
  "Not using the product enough",
  "Found a better alternative",
  "Missing features I need",
  "Technical issues",
  "Not what I expected",
  "Temporary pause",
  "Other",
];

export default function CancelSubscription() {
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReason, setSelectedReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/");
        return;
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleCancel = async () => {
    if (!selectedReason) {
      alert("Please select a reason for canceling.");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate("/");
        return;
      }

      const token = await user.getIdToken();
      const result = await cancelSubscription(token, selectedReason);

      if (result.success) {
        alert(
          "Your subscription has been canceled. You'll retain access until the end of your billing period."
        );
        navigate(createPageUrl("Subscription"));
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to cancel subscription";
        console.error("Failed to cancel subscription:", errorMsg);
        alert("Failed to cancel subscription. Please try again.");
      }
    } catch (error) {
      console.error("Error canceling subscription:", error);
      alert("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1E3A8A]/30 border-t-[#1E3A8A] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Link to={createPageUrl("Subscription")}>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Subscription
            </Button>
          </Link>
        </motion.div>

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl p-8"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Cancel Subscription
            </h1>
            <p className="text-gray-600">
              We're sorry to see you go. Your subscription will remain active
              until the end of your billing period.
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <label
                htmlFor="reason"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Why are you canceling? <span className="text-red-500">*</span>
              </label>
              <Select
                value={selectedReason}
                onValueChange={setSelectedReason}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CANCELLATION_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl("Subscription"))}
                className="flex-1"
                disabled={isSubmitting}
              >
                Keep Subscription
              </Button>
              <Button
                onClick={handleCancel}
                disabled={!selectedReason || isSubmitting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isSubmitting ? "Canceling..." : "Cancel Subscription"}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

