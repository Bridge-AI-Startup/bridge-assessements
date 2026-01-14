import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { createPageUrl } from "@/utils";
import { auth } from "@/firebase/firebase";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function Pricing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Floating Pill Navigation */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="bg-white/80 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 px-4 py-2 flex items-center justify-between gap-12">
          <div className="flex items-center gap-2">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
                <img
                  src={bridgeLogo}
                  alt="Bridge"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="font-semibold text-gray-900 text-sm">Bridge</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                window.location.href = createPageUrl("Pricing");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Pricing
            </Button>
            <Button
              onClick={() => {
                window.location.href = createPageUrl("Contact");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Contact
            </Button>
            <Button
              onClick={() => {
                const user = auth.currentUser;
                if (user) {
                  window.location.href = createPageUrl("Home");
                } else {
                  window.location.href = createPageUrl("GetStarted");
                }
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign In
            </Button>
            <Button
              onClick={() => (window.location.href = createPageUrl("GetStarted"))}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign Up
            </Button>
            <Button
              onClick={() =>
                window.open(
                  "https://calendly.com/smahadkar-ucsd/30min",
                  "_blank"
                )
              }
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Book a Demo
            </Button>
          </div>
        </nav>
      </div>

      {/* Pricing Section */}
      <div className="bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] py-24 md:py-32 pt-32">
        <div className="max-w-6xl mx-auto px-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Choose Your Plan
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Start with our free tier to evaluate candidates, then upgrade for
              unlimited access.
            </p>
          </motion.div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {[
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
                cta: "Current Plan",
                ctaVariant: "outline",
                popular: false,
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
                cta: "Upgrade Now",
                ctaVariant: "default",
                popular: true,
              },
            ].map((tier, index) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className={`relative bg-white rounded-2xl shadow-xl overflow-hidden border-2 ${
                  tier.popular
                    ? "border-green-500 scale-105"
                    : "border-gray-200"
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
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">
                      {tier.name}
                    </h3>
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
                      tier.popular
                        ? () => {
                            // Check if user is logged in
                            const user = auth.currentUser;
                            if (user) {
                              window.location.href =
                                createPageUrl("Subscription");
                            } else {
                              // Store flag to redirect to subscription after signup
                              localStorage.setItem(
                                "redirect_to_subscription",
                                "true"
                              );
                              window.location.href =
                                createPageUrl("GetStarted");
                            }
                          }
                        : undefined
                    }
                    variant={tier.ctaVariant}
                    disabled={!tier.popular}
                    className={`w-full py-6 text-lg font-semibold ${
                      tier.popular
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-gray-100 text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    {tier.cta}
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Additional Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-12 text-center"
          >
            <p className="text-sm text-gray-500">
              All plans include full access to BridgeAI features. Upgrade
              anytime to unlock unlimited candidates.
            </p>
          </motion.div>
        </div>
      </div>

    </div>
  );
}

