import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Mail, Lock, AlertCircle, ArrowRight, ArrowLeft } from "lucide-react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth } from "@/firebase/firebase";
import { createPageUrl } from "@/utils";
import { verifyUser } from "@/api/user";
import { MARKETING_ORIGIN } from "@/config/origins";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      window.location.href = createPageUrl("Home");
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const token = await userCredential.user.getIdToken();
      const result = await verifyUser(token);

      if (!result.success) {
        const errorMsg =
          "error" in result
            ? result.error
            : "Authentication failed. Please try again.";
        setError(errorMsg);
        setIsLoading(false);
        return;
      }

      window.location.href = createPageUrl("Home");
    } catch (err) {
      if (err.code === "auth/invalid-email") {
        setError("Invalid email address");
      } else if (err.code === "auth/wrong-password") {
        setError("Incorrect password");
      } else if (err.code === "auth/user-not-found") {
        setError("No account found with this email");
      } else {
        setError("Login failed. Please try again.");
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#dbeafe] via-[#eff6ff] to-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md relative"
      >
        <a
          href={MARKETING_ORIGIN}
          className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to landing
        </a>
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center mx-auto mb-4">
            <img
              src={bridgeLogo}
              alt="Bridge"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-gray-500 text-sm">
            Sign in to continue to your dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
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
            className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5 rounded-xl font-semibold disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <a
            href={createPageUrl("GetStarted")}
            className="text-[#1E3A8A] font-medium hover:underline"
          >
            Sign up free
          </a>
        </div>
      </motion.div>
    </div>
  );
}
