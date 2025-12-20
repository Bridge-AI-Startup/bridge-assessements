import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  FileText,
  Users,
  CheckCircle,
  Clock,
  MoreVertical,
  Archive,
  Trash2,
  Edit,
  LogOut,
  User,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getAssessments, deleteAssessment } from "@/api/assessment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";

export default function Home() {
  const [currentUser, setCurrentUser] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Wait for auth state to be ready
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("🔄 [Home] Auth state changed, user:", user?.email);
      setCurrentUser(user);

      if (!user) {
        console.warn("⚠️ [Home] No user found, redirecting to landing");
        window.location.href = createPageUrl("Landing");
        return;
      }

      // Fetch assessments
      const fetchAssessments = async () => {
        setIsLoading(true);
        setError(null);
        try {
          console.log("🔄 [Home] Fetching assessments...");
          const result = await getAssessments();
          console.log("📦 [Home] getAssessments result:", result);

          if (result.success) {
            console.log("✅ [Home] Assessments loaded:", result.data);
            setAssessments(result.data || []);
          } else {
            const errorMsg =
              "error" in result ? result.error : "Failed to load assessments";
            setError(errorMsg);
            console.error("❌ [Home] Failed to load assessments:", errorMsg);
          }
        } catch (err) {
          console.error("❌ [Home] Error fetching assessments:", err);
          setError(err.message || "An unexpected error occurred");
        } finally {
          setIsLoading(false);
        }
      };

      fetchAssessments();
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Redirect to landing page after logout
      window.location.href = createPageUrl("Landing");
    } catch (error) {
      console.error("Logout error:", error);
      // Still redirect even if logout fails
      window.location.href = createPageUrl("Landing");
    }
  };

  const handleDelete = async (assessmentId) => {
    if (!confirm("Are you sure you want to delete this assessment?")) {
      return;
    }

    try {
      const result = await deleteAssessment(assessmentId);
      if (result.success) {
        // Remove from local state
        setAssessments(assessments.filter((a) => a._id !== assessmentId));
      } else {
        const errorMsg =
          "error" in result ? result.error : "Failed to delete assessment";
        alert(errorMsg);
      }
    } catch (err) {
      console.error("Error deleting assessment:", err);
      alert("Failed to delete assessment");
    }
  };

  const formatTimeLimit = (minutes) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h1 className="text-2xl font-bold text-[#1E3A8A] mb-1">
              Assessments
            </h1>
            <p className="text-gray-500 text-sm">
              Manage your technical assessments
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link to={createPageUrl("CreateAssessment")}>
              <Button className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full px-5">
                <Plus className="w-4 h-4 mr-2" />
                New Assessment
              </Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="rounded-full h-9 w-9 p-0">
                  <div className="w-8 h-8 rounded-full bg-[#1E3A8A] flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {currentUser && (
                  <>
                    <div className="px-2 py-1.5 text-sm text-gray-500">
                      <div className="font-medium text-gray-900">
                        {currentUser.email}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-600 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Assessments Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse"
              >
                <div className="h-5 bg-gray-200 rounded w-3/4 mb-3"></div>
                <div className="h-4 bg-gray-100 rounded w-full mb-4"></div>
                <div className="h-8 bg-gray-100 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        ) : assessments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 p-12 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-[#1E3A8A]/10 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-[#1E3A8A]" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No assessments yet
            </h3>
            <p className="text-gray-500 mb-6">
              Create your first technical assessment to start evaluating
              candidates
            </p>
            <Link to={createPageUrl("CreateAssessment")}>
              <Button className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full px-6">
                <Plus className="w-4 h-4 mr-2" />
                Create Assessment
              </Button>
            </Link>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {assessments.map((assessment, index) => (
              <motion.div
                key={assessment._id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">
                      {assessment.title}
                    </h3>
                    <Badge className="bg-blue-100 text-blue-700">Active</Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1.5 hover:bg-gray-100 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          window.location.href =
                            createPageUrl("AssessmentEditor") +
                            `?id=${assessment._id}`;
                        }}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => handleDelete(assessment._id)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                  {assessment.description || "No description"}
                </p>

                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>{formatTimeLimit(assessment.timeLimit)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4" />
                    <span>
                      Created{" "}
                      {new Date(assessment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                  <Link
                    to={
                      createPageUrl("AssessmentEditor") +
                      `?id=${assessment._id}`
                    }
                    className="flex-1"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[#1E3A8A] border-[#1E3A8A]/20 hover:bg-[#1E3A8A]/5"
                    >
                      Open
                    </Button>
                  </Link>
                  <Link
                    to={
                      createPageUrl("SubmissionsDashboard") +
                      `?assessmentId=${assessment._id}`
                    }
                    className="flex-1"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[#1E3A8A] border-[#1E3A8A]/20 hover:bg-[#1E3A8A]/5"
                    >
                      <BarChart3 className="w-4 h-4 mr-1.5" />
                      Submissions
                    </Button>
                  </Link>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
