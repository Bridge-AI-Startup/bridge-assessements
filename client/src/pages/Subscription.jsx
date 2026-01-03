import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  createCheckoutSession,
  getBillingStatus,
  reactivateSubscription,
} from "@/api/billing";

export default function Subscription() {
  const [isLoading, setIsLoading] = useState(true);
  const [billingStatus, setBillingStatus] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/");
        return;
      }

      // Fetch billing status to determine current plan
      try {
        const token = await user.getIdToken();
        const result = await getBillingStatus(token);
        if (result.success) {
          setBillingStatus(result.data);
        }
      } catch (error) {
        console.error("Error fetching billing status:", error);
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
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Determine current plan based on billing status
  const isSubscribed = billingStatus?.subscribed === true;
  const isCanceled = billingStatus?.cancelAtPeriodEnd === true;

  const tiers = [
    {
      name: "Free",
      subtitle: "Evaluation Access",
      price: "$0",
      period: "forever",
      color: "blue",
      description: "Full access. Evaluate up to 3 candidates.",
      features: [
        "1 assessment",
        "Up to 3 candidate submissions total",
        "Full AI follow-up interview",
        "Assessment drop off analytics",
      ],
      cta: isCanceled
        ? "Canceled"
        : isSubscribed
        ? "Unsubscribe"
        : "Current Plan",
      ctaVariant: "outline",
      popular: false,
      isCurrentPlan: !isSubscribed && !isCanceled,
      showUnsubscribe: isSubscribed && !isCanceled,
      showCanceled: isCanceled,
    },
    {
      name: "Early Access",
      subtitle: "Unlimited",
      price: "$49",
      period: "month",
      color: "green",
      description: "Unlimited candidates. Run your hiring on Bridge.",
      features: [
        "Unlimited submissions",
        "Unlimited assessments",
        "Full AI follow-up interview",
        "Assessment drop off analytics",
      ],
      cta: isCanceled
        ? "Resubscribe"
        : isSubscribed
        ? "Current Plan"
        : "Upgrade Now",
      ctaVariant: isCanceled ? "default" : isSubscribed ? "outline" : "default",
      popular: !isSubscribed || isCanceled,
      isCurrentPlan: isSubscribed && !isCanceled,
      showResubscribe: isCanceled,
    },
  ];

  const handleUpgrade = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate("/");
        return;
      }

      const token = await user.getIdToken();

      // If subscription is canceled, reactivate it instead of creating new checkout
      if (isCanceled) {
        const result = await reactivateSubscription(token);
        if (result.success) {
          alert("Your subscription has been reactivated!");
          // Refresh billing status
          const statusResult = await getBillingStatus(token);
          if (statusResult.success) {
            setBillingStatus(statusResult.data);
          }
        } else {
          const errorMsg =
            "error" in result
              ? result.error
              : "Failed to reactivate subscription";
          console.error("Failed to reactivate subscription:", errorMsg);
          alert("Failed to reactivate subscription. Please try again.");
        }
        return;
      }

      // Otherwise, create new checkout session
      const result = await createCheckoutSession(token);

      if (result.success && result.data.url) {
        // Redirect to Stripe Checkout
        window.location.href = result.data.url;
      } else {
        const errorMsg =
          "error" in result
            ? result.error
            : "Failed to create checkout session";
        console.error("Failed to create checkout session:", errorMsg);
        alert("Failed to start checkout. Please try again.");
      }
    } catch (error) {
      console.error("Error creating checkout session:", error);
      alert("An error occurred. Please try again.");
    }
  };

  const handleUnsubscribe = () => {
    // Navigate to cancellation page instead of canceling immediately
    navigate(createPageUrl("CancelSubscription"));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Link to={createPageUrl("Home")}>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Assessments
            </Button>
          </Link>
        </motion.div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Start with our free tier to evaluate candidates, then upgrade for
            unlimited access.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {tiers.map((tier, index) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative bg-white rounded-2xl shadow-xl overflow-hidden border-2 ${
                tier.popular ? "border-green-500 scale-105" : "border-gray-200"
              }`}
            >
              {tier.popular && (
                <div className="absolute top-0 right-0 bg-green-500 text-white px-4 py-1 text-sm font-semibold rounded-bl-lg">
                  Popular
                </div>
              )}

              <div className="p-8">
                {/* Tier Header */}
                <div className="mb-6">
                  <div
                    className={`inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3 ${
                      tier.color === "blue"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {tier.subtitle}
                  </div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">
                    {tier.name}
                  </h2>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-5xl font-bold text-gray-900">
                      {tier.price}
                    </span>
                    {tier.period !== "forever" && (
                      <span className="text-gray-500">/{tier.period}</span>
                    )}
                  </div>
                  <p className="text-gray-600 text-sm">{tier.description}</p>
                </div>

                {/* Features List */}
                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <Check
                        className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                          tier.color === "blue"
                            ? "text-blue-600"
                            : "text-green-600"
                        }`}
                      />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                <Button
                  onClick={
                    tier.isCurrentPlan
                      ? undefined
                      : tier.showUnsubscribe
                      ? handleUnsubscribe
                      : tier.showResubscribe || tier.name === "Early Access"
                      ? handleUpgrade
                      : undefined
                  }
                  variant={tier.ctaVariant}
                  disabled={
                    tier.isCurrentPlan &&
                    !tier.showUnsubscribe &&
                    !tier.showCanceled
                  }
                  className={`w-full py-6 text-lg font-semibold ${
                    tier.isCurrentPlan &&
                    !tier.showUnsubscribe &&
                    !tier.showCanceled
                      ? "bg-gray-100 text-gray-600 cursor-not-allowed"
                      : tier.showUnsubscribe
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : tier.showCanceled
                      ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                      : tier.name === "Early Access"
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-gray-100 text-gray-600 cursor-not-allowed"
                  }`}
                >
                  {tier.cta || "Current Plan"}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Additional Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-12 text-center"
        >
          <p className="text-sm text-gray-500">
            All plans include full access to BridgeAI features. Upgrade anytime
            to unlock unlimited candidates.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
