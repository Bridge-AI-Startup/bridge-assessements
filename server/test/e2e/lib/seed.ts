/**
 * Direct Mongo/service fallback used when the authenticated employer API path
 * is unavailable (e.g. the Firebase Admin credential is invalid in this env, so
 * verifyAuthToken rejects every token). Seeding lets the candidate/token-based
 * and analysis pipelines still run against the REAL services (Mongo, S3,
 * Pinecone, OpenAI) so we can produce genuine evidence for those processes.
 *
 * These call the exact same service functions the controllers call — only the
 * auth middleware is bypassed.
 */

import "../../../src/config/loadEnv.js";

import connectMongoose from "../../../src/db/mongooseConnection.js";
import AssessmentModel from "../../../src/models/assessment.js";
import SubmissionModel from "../../../src/models/submission.js";
import UserModel from "../../../src/models/user.js";

export interface SeededContext {
  userId: string;
  assessmentId: string;
  token: string;
  submissionId: string;
  shareLink: string;
}

function shareLinkFor(token: string): string {
  const base =
    process.env.SHARE_LINK_BASE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173";
  return `${base}/CandidateAssessment?token=${token}`;
}

export async function seedRecruiterAssessmentSubmission(opts: {
  firebaseUid: string;
  email: string;
  companyName: string;
}): Promise<SeededContext> {
  await connectMongoose();

  let user = await UserModel.findOne({ firebaseUid: opts.firebaseUid });
  if (!user) {
    user = await UserModel.create({
      firebaseUid: opts.firebaseUid,
      email: opts.email,
      companyName: opts.companyName,
    });
  }

  const assessment = await AssessmentModel.create({
    userId: user._id,
    title: `E2E Seeded Assessment ${Date.now()}`,
    description:
      "Build a small REST endpoint that sums a list of integers and returns JSON. " +
      "Requirements: input validation, an error path for non-numeric input, and a passing unit test.",
    timeLimit: 60,
    evaluationCriteria: [
      "Candidate kept the editor and terminal focused on the task",
      "No large unexplained paste events",
      "Iterative test-driven progress is visible",
    ],
    behavioralChecks: [
      "The endpoint returns correct JSON for a valid list",
      "Invalid input produces a clear error response",
    ],
  });

  const submission = await SubmissionModel.create({
    assessmentId: assessment._id,
    candidateName: "E2E Candidate",
    candidateEmail: `e2e+candidate.${Date.now()}@bridge-e2e.test`,
    status: "pending",
  });

  return {
    userId: user._id.toString(),
    assessmentId: assessment._id.toString(),
    token: submission.token,
    submissionId: submission._id.toString(),
    shareLink: shareLinkFor(submission.token),
  };
}

/** Seed an additional pending submission for an existing assessment. */
export async function seedSubmission(assessmentId: string): Promise<{
  token: string;
  submissionId: string;
  shareLink: string;
}> {
  await connectMongoose();
  const submission = await SubmissionModel.create({
    assessmentId,
    candidateName: "E2E Video Candidate",
    status: "pending",
  });
  return {
    token: submission.token,
    submissionId: submission._id.toString(),
    shareLink: shareLinkFor(submission.token),
  };
}

/** Mirror of the dashboard query (employer list) without auth. */
export async function readSubmissionsForAssessment(
  assessmentId: string
): Promise<any[]> {
  await connectMongoose();
  return SubmissionModel.find({ assessmentId })
    .sort({ submittedAt: -1, createdAt: -1 })
    .lean();
}

/** Chunk-based repo indexing via the same service the controller uses. */
export async function directIndexRepo(submissionId: string) {
  const { indexSubmissionRepo } = await import(
    "../../../src/services/repoIndexing.js"
  );
  return indexSubmissionRepo(submissionId);
}

/** RAG interview-question generation via the service layer. */
export async function directGenerateInterview(submissionId: string) {
  await connectMongoose();
  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!submission) throw new Error("submission not found");
  const assessment = submission.assessmentId as any;
  const { generateInterviewQuestionsFromRetrieval } = await import(
    "../../../src/services/interviewGeneration.js"
  );
  const result = await generateInterviewQuestionsFromRetrieval(
    submissionId,
    assessment.description,
    assessment.numInterviewQuestions ?? 2,
    assessment.interviewerCustomInstructions
  );
  // Persist like the controller does so it surfaces on the submission.
  (submission as any).interviewQuestions = result.questions.map((q: any) => ({
    ...q,
    createdAt: new Date(),
  }));
  await submission.save();
  return result;
}

/** Scoring via the service layer. */
export async function directCalculateScores(submissionId: string) {
  const { calculateAndSaveScores } = await import(
    "../../../src/services/scoring.js"
  );
  return calculateAndSaveScores(submissionId);
}
