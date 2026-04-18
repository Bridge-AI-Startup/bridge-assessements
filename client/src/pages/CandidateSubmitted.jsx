import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Link as LinkIcon,
  FileCheck,
  Clock,
  Calendar,
  X,
} from "lucide-react";
import { getSubmissionByToken } from "@/api/submission";
import { createPageUrl } from "@/utils";

export default function CandidateSubmitted() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [submission, setSubmission] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate("/");
      return;
    }

    const loadSubmission = async () => {
      setIsLoading(true);
      try {
        const result = await getSubmissionByToken(token);
        if (result.success) {
          setSubmission(result.data);
          const assessmentData = result.data.assessmentId;
          if (typeof assessmentData === "object" && assessmentData !== null) {
            setAssessment(assessmentData);
          }

          if (result.data.status === "opted-out") {
            setIsLoading(false);
            return;
          }

          if (
            result.data.status !== "submitted" &&
            result.data.status !== "expired"
          ) {
            navigate(`${createPageUrl("CandidateAssessment")}?token=${token}`);
            return;
          }
        } else {
          console.error("Failed to load submission");
        }
      } catch (error) {
        console.error("Error loading submission:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSubmission();
  }, [token, navigate]);

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

  if (!submission || !assessment) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load submission</p>
        </div>
      </div>
    );
  }

  const isExpired = submission.status === "expired";
  const isOptedOut = submission.status === "opted-out";

  if (isOptedOut) {
    const optedOutBeforeStarting = !submission.startedAt;

    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
        >
          <div className="bg-orange-500 px-8 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4">
              <X className="w-10 h-10 text-orange-500" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              You Have Opted Out
            </h1>
            <p className="text-white/90">
              {optedOutBeforeStarting
                ? "You have chosen not to start this assessment"
                : "You have chosen not to complete this assessment"}
            </p>
          </div>

          <div className="p-8">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                {assessment.title}
              </h2>
              {optedOutBeforeStarting ? (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-blue-800 font-medium">
                    ℹ️ You opted out before starting the assessment
                  </p>
                </div>
              ) : (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
                  <p className="text-xs text-orange-800 font-medium">
                    ⚠️ You opted out after starting the assessment
                  </p>
                </div>
              )}
              {submission.optOutReason && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Your reason:
                  </p>
                  <p className="text-sm text-gray-600">
                    {submission.optOutReason}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <p className="text-sm text-orange-800">
                <strong>Note:</strong>{" "}
                {optedOutBeforeStarting
                  ? "You opted out before starting the assessment. If you change your mind, please contact the assessment team."
                  : "You opted out after starting the assessment. If you change your mind, please contact the assessment team."}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8f9fb] to-[#eef1f8] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden"
      >
        <div
          className={`px-8 py-6 text-center ${
            isExpired ? "bg-orange-500" : "bg-green-500"
          }`}
        >
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4">
            <CheckCircle
              className={`w-10 h-10 ${
                isExpired ? "text-orange-500" : "text-green-500"
              }`}
            />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">
            {isExpired
              ? "Assessment Submitted (Time Expired)"
              : "Assessment Submitted Successfully!"}
          </h1>
          <p className="text-white/90">
            {isExpired
              ? "Your submission was received after the time limit"
              : "Thank you for completing the assessment"}
          </p>
        </div>

        <div className="p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {assessment.title}
            </h2>
            <div className="space-y-2 text-sm text-gray-600">
              {submission.candidateName && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Candidate:</span>
                  <span>{submission.candidateName}</span>
                </div>
              )}
              {submission.candidateEmail && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Email:</span>
                  <span>{submission.candidateEmail}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 mb-6">
            {submission.githubLink && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-start gap-3">
                  <LinkIcon className="w-5 h-5 text-[#1E3A8A] flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">
                      GitHub Repository
                    </h3>
                    <a
                      href={submission.githubLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1E3A8A] hover:underline text-sm break-all"
                    >
                      {submission.githubLink}
                    </a>
                  </div>
                </div>
              </div>
            )}
            {submission.codeSource === "upload" && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-start gap-3">
                  <FileCheck className="w-5 h-5 text-[#1E3A8A] flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">
                      Project Archive Uploaded
                    </h3>
                    <p className="text-sm text-gray-600">
                      {submission.codeUpload?.originalFilename || "submission.zip"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {submission.timeSpent !== undefined && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500">Time Spent</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {submission.timeSpent} minutes
                  </p>
                </div>
              )}

              {submission.submittedAt && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500">Submitted At</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div
            className={`p-4 rounded-xl mb-6 ${
              isExpired
                ? "bg-orange-50 border border-orange-200"
                : "bg-blue-50 border border-blue-200"
            }`}
          >
            <p
              className={`text-sm ${
                isExpired ? "text-orange-800" : "text-blue-800"
              }`}
            >
              {isExpired ? (
                <>
                  <strong>Note:</strong> Your submission was received after the
                  time limit had expired. The assessment team will review your
                  submission.
                </>
              ) : (
                <>
                  <strong>What&apos;s next?</strong> Your submission has been
                  received and will be reviewed by the assessment team. You will
                  be contacted with the results.
                </>
              )}
            </p>
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-500">
              You can close this page. Your submission has been saved.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
