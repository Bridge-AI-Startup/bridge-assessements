import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  ArrowLeft,
  Upload,
  Mail,
  Lock,
  AlertCircle,
} from "lucide-react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { createUser } from "@/api/user";
import { createPageUrl } from "@/utils";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function GetStarted() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  // Check if user is already signed in or if email was passed from signup
  useEffect(() => {
    const pendingEmail = localStorage.getItem("pending_email");
    if (pendingEmail) {
      setEmail(pendingEmail);
      localStorage.removeItem("pending_email");
    }

    // Get initial user state
    const user = auth.currentUser;
    setCurrentUser(user);
    if (user && user.email) {
      setEmail(user.email);
    }
  }, []);

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setLogo(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleContinue = async (e) => {
    e.preventDefault();
    setError("");

    // Create account if user doesn't exist (Firebase will validate password)
    if (!currentUser) {
      setIsLoading(true);
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        // Update currentUser after signup
        setCurrentUser(auth.currentUser);
      } catch (err) {
        console.error("Sign up error:", err);
        // Handle Firebase auth errors
        if (err.code === "auth/email-already-in-use") {
          setError("This email is already registered. Please sign in instead.");
        } else if (err.code === "auth/invalid-email") {
          setError("Invalid email address");
        } else if (err.code === "auth/weak-password") {
          setError("Password should be at least 6 characters");
        } else {
          setError("Failed to create account. Please try again.");
        }
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);

    try {
      // Get Firebase user
      const user = auth.currentUser;
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Create or update user in backend database (companyName is saved here)
      console.log("🔄 [GetStarted] Saving user data to backend...");
      console.log("   Company Name:", companyName);
      console.log("   Current User exists:", !!currentUser);

      const userData = {
        companyName: companyName,
        companyLogoUrl: logoPreview || null,
      };

      try {
        // If Firebase signup succeeded, user is new - create in backend
        console.log("   📝 Creating user in backend...");
        const createResult = await createUser(userData);

        if (!createResult.success) {
          const errorMsg =
            "error" in createResult
              ? createResult.error
              : "Failed to create user";
          throw new Error(errorMsg);
        }
        console.log("   ✅ User created successfully");
      } catch (backendError) {
        console.error("Backend user creation error:", backendError);

        // Check if it's a network error
        const isNetworkErr =
          backendError.message?.includes("Failed to fetch") ||
          backendError.message?.includes("NetworkError");

        if (isNetworkErr) {
          console.warn(
            "Backend is offline. Storing data locally for later sync."
          );
          // Store user data in localStorage for sync when backend comes online
          localStorage.setItem(
            "pending_backend_sync",
            JSON.stringify({
              companyName: companyName,
              companyLogoUrl: logoPreview || null,
              timestamp: Date.now(),
            })
          );
        } else {
          // If create fails for non-network reasons, show error and stop
          console.error("Backend error details:", backendError);
          setError(
            backendError.message ||
              "Failed to create user account. Please try again."
          );
          setIsLoading(false);
          return; // Don't redirect if backend creation fails
        }
      }

      // Only redirect if backend creation succeeded
      // Get the job description from landing page
      const jobDescription =
        localStorage.getItem("pending_job_description") || "";
      localStorage.setItem("company_name", companyName);
      localStorage.setItem("user_email", email);

      // Store logo if provided
      if (logoPreview) {
        localStorage.setItem("logo_preview", logoPreview);
      }

      // Navigate to assessment editor with job description
      window.location.href =
        createPageUrl("AssessmentEditor") +
        `?description=${encodeURIComponent(jobDescription)}`;
    } catch (err) {
      console.error("Error:", err);
      setError(err.message || "An error occurred. Please try again.");
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
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => {
            window.location.href = createPageUrl("Landing");
          }}
          className="absolute top-4 left-4 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full p-2"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center mx-auto mb-4">
            <img
              src={bridgeLogo}
              alt="Bridge"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Set up your company
          </h1>
          <p className="text-gray-500 text-sm">
            Create your account and add company details
          </p>
        </div>

        <form onSubmit={handleContinue} className="space-y-5">
          {/* Email */}
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
                disabled={!!currentUser}
              />
            </div>
          </div>

          {/* Password - Only show if user is not already signed in */}
          {!currentUser && (
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
                  placeholder="Enter your password (min. 6 characters)"
                  className="pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>
          )}

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Company logo
            </label>
            <div
              onClick={() => document.getElementById("logo-upload").click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-[#1E3A8A]/30 transition-colors"
            >
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Logo preview"
                  className="w-16 h-16 object-contain mx-auto"
                />
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Click to upload logo</p>
                </>
              )}
              <input
                id="logo-upload"
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Company name
            </label>
            <Input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              className="w-full"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={
              isLoading ||
              !email.trim() ||
              (!currentUser && !password.trim()) ||
              !companyName.trim()
            }
            className="w-full bg-[#1E3A8A] hover:bg-[#152a66] text-white py-5 rounded-xl font-semibold disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Setting up...
              </span>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
