import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, ArrowRight, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  signIn,
  signUp,
  getAuthErrorMessage,
  loginUserInBackend,
} from "@/auth";
import { createPageUrl } from "@/utils";

export default function AuthModal({
  isOpen,
  onClose,
  defaultTab = "login",
  showTabs = true,
  signupRedirect = "GetStarted", // Default redirect after signup
}) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (activeTab === "signup") {
        // Create account and redirect (Firebase will validate email and password)
        await signUp(email, password);

        // Create/login user in backend database
        try {
          await loginUserInBackend();
        } catch (backendError) {
          console.error("Backend login error:", backendError);
          // Continue even if backend call fails - user is still authenticated in Firebase
        }

        // Redirect based on signupRedirect prop
        if (signupRedirect === "GetStarted") {
          // Store email for GetStarted page
          localStorage.setItem("pending_email", email);
        }
        window.location.href = createPageUrl(signupRedirect);
      } else {
        // Sign in
        await signIn(email, password);

        // Create/login user in backend database
        try {
          await loginUserInBackend();
        } catch (backendError) {
          console.error("Backend login error:", backendError);
          // Continue even if backend call fails - user is still authenticated in Firebase
        }

        // Redirect to Home on successful login
        window.location.href = createPageUrl("Home");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setError(getAuthErrorMessage(err));
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-[#1E3A8A] to-[#1e40af] px-6 py-8 text-center">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center mx-auto mb-4">
              <span className="text-[#1E3A8A] font-bold text-xl">B</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">
              {activeTab === "login"
                ? "Welcome back"
                : "Get started with Bridge"}
            </h2>
            <p className="text-blue-200 text-sm">
              {activeTab === "login"
                ? "Sign in to continue to your dashboard"
                : "Create your account in seconds"}
            </p>
          </div>

          {/* Tabs */}
          {showTabs && (
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab("login")}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === "login"
                    ? "text-[#1E3A8A] border-b-2 border-[#1E3A8A]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => setActiveTab("signup")}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === "signup"
                    ? "text-[#1E3A8A] border-b-2 border-[#1E3A8A]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Sign Up
              </button>
            </div>
          )}

          {/* Form */}
          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5 rounded-xl font-semibold"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {activeTab === "login"
                      ? "Signing in..."
                      : "Creating account..."}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    {activeTab === "login" ? "Sign In" : "Create Account"}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>

            {showTabs && (
              <div className="mt-6 text-center text-sm text-gray-500">
                {activeTab === "login" ? (
                  <>
                    Don't have an account?{" "}
                    <button
                      onClick={() => setActiveTab("signup")}
                      className="text-[#1E3A8A] font-medium hover:underline"
                    >
                      Sign up free
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      onClick={() => setActiveTab("login")}
                      className="text-[#1E3A8A] font-medium hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
