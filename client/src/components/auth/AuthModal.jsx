import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, ArrowRight, Lock, AlertCircle } from "lucide-react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth } from "../../firebase/firebase";
import { createPageUrl } from "@/utils";
import { verifyUser } from "../../api/user";

export default function AuthModal({ isOpen, onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Sign in
      console.log("🔄 [AuthModal] Starting sign in process...");
      console.log("   Email:", email);

      console.log("   Step 1: Authenticating with Firebase...");
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const token = await userCredential.user.getIdToken();
      console.log("   ✅ Firebase authentication successful");
      console.log("   Step 2: Verifying user with backend...");
      const result = await verifyUser(token);
      console.log("   [AuthModal] verifyUser result:", result);
      if (!result.success) {
        const errorMsg =
          "error" in result
            ? result.error
            : "Authentication failed. Please try again.";
        console.error("   ❌ Backend verification failed:", errorMsg);
        setError(errorMsg);
        setIsLoading(false);
        return;
      }
      console.log("   ✅ Backend verification successful");

      // Redirect to Home on successful login
      const homeUrl = createPageUrl("Home");
      console.log("   Step 3: Redirecting to Home...");
      console.log("   URL:", homeUrl);

      // Close modal before redirect
      onClose();

      // Small delay to ensure modal closes smoothly
      setTimeout(() => {
        window.location.href = homeUrl;
      }, 100);
    } catch (err) {
      console.error("❌ [AuthModal] Auth error:", err);
      console.error("   Error code:", err.code);
      console.error("   Error message:", err.message);
      if (err instanceof Error) {
        // Handle Firebase auth errors
        if (err.message.includes("auth/invalid-email")) {
          setError("Invalid email address");
        } else if (err.message.includes("auth/wrong-password")) {
          setError("Incorrect password");
        } else if (err.message.includes("auth/user-not-found")) {
          setError("No account found with this email");
        } else {
          setError("Login failed. Please try again.");
        }
      }
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
            <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
            <p className="text-blue-200 text-sm">
              Sign in to continue to your dashboard
            </p>
          </div>

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
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Sign In
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-500">
              Don't have an account?{" "}
              <button
                onClick={() => {
                  onClose();
                  window.location.href = createPageUrl("GetStarted");
                }}
                className="text-[#1E3A8A] font-medium hover:underline"
              >
                Sign up free
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
