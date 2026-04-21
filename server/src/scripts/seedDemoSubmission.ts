/**
 * Seed demo data for saaz@bridge-jobs.com: one assessment, Saaz's submission (full
 * evaluation + interview), and several extra dummy submissions with mixed statuses.
 * For local/demo use.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/seedDemoSubmission.ts
 *
 * Recommended: sign up as saaz@bridge-jobs.com in the app first, then run this script
 * so the assessment and submission appear under your account. If the user does
 * not exist, a stub user is created (firebaseUid: demo-saaz-bridge).
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import crypto from "crypto";
import connectMongoose from "../db/mongooseConnection.js";
import UserModel from "../models/user.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";

const DEMO_EMAIL = "saaz@bridge-jobs.com";
const DEMO_FIREBASE_UID = "demo-saaz-bridge";

const DEMO_INTERVIEW_TRANSCRIPT = {
  turns: [
    { role: "agent" as const, text: "Thanks for joining. Can you walk me through how you approached the news recommendation feature?", startMs: 0, endMs: 4000 },
    { role: "candidate" as const, text: "I started by reading the requirements and then set up the MERN stack. I built the backend API for articles and user reading history, and implemented a simple similarity-based recommendation algorithm.", startMs: 4000, endMs: 12000 },
    { role: "agent" as const, text: "How did you handle marking articles as read and storing that in the user profile?", startMs: 12000, endMs: 16000 },
    { role: "candidate" as const, text: "I used MongoDB to store a readArticles array on the user document. The frontend calls a PATCH endpoint when the user clicks an article, and the recommendation endpoint filters out already-read articles.", startMs: 16000, endMs: 24000 },
    { role: "agent" as const, text: "What was the trickiest part of the implementation?", startMs: 24000, endMs: 28000 },
    { role: "candidate" as const, text: "Getting the recommendation algorithm to feel relevant with the mock data. I went with a simple approach: find articles that share keywords with the user's read articles, then rank by overlap.", startMs: 28000, endMs: 36000 },
    { role: "agent" as const, text: "Did you add any tests or validation?", startMs: 36000, endMs: 40000 },
    { role: "candidate" as const, text: "Yes, I added unit tests for the recommendation logic and validation on the API. I also included a README with setup instructions.", startMs: 40000, endMs: 48000 },
    { role: "agent" as const, text: "That covers what I needed. Thank you for your time. This completes our interview.", startMs: 48000, endMs: 52000 },
    { role: "candidate" as const, text: "Thank you. Happy to discuss more if needed.", startMs: 52000, endMs: 58000 },
  ],
};

const DEMO_INTERVIEW_SUMMARY =
  "The candidate discussed their approach to the news article recommendation system. They set up a MERN stack, implemented endpoints for articles and reading history, and built a similarity-based recommendation algorithm using shared keywords. They added unit tests, API validation, and documentation. The interview concluded with a brief recap and thank you.";

// Dense evidence across ~52 min (3120s) so the timeline is largely filled with colored segments
const DEMO_EVALUATION_REPORT = {
  session_summary:
    "Scaffolding: asked Cursor for initial API structure and recommendation logic, then refactored variable names and types. Iteration: requested test cases from the agent, ran the suite, then prompted for an edge-case fix when one test failed. Mixed specificity: one strong prompt with constraints; later a vague, browser-referencing prompt ('match the example from the page I have open'). Used browser for docs mid-task instead of a second agent. Planning was clear once, then skipped before asking for tests.",
  criteria_results: [
    {
      criterion: "Tests and debugs",
      score: 9,
      confidence: "high",
      verdict: "Added unit tests, ran suite, fixed off-by-one edge case with help from the agent.",
      evaluable: true,
      evidence: [
        { ts: 120, ts_end: 195, observation: "Wrote first unit test for recommendation logic; ran npm test." },
        { ts: 255, ts_end: 320, observation: "Saw one failing test; ran again to confirm, then asked agent for fix." },
        { ts: 365, ts_end: 435, observation: "Applied edge-case fix, re-ran tests; all passing." },
        { ts: 520, ts_end: 610, observation: "Added integration test for recommendation endpoint." },
        { ts: 720, ts_end: 800, observation: "Ran full test suite; adjusted timeout for one flaky test." },
        { ts: 950, ts_end: 1040, observation: "Wrote test for empty read history; fixed assertion." },
        { ts: 1180, ts_end: 1260, observation: "Debugged failing test; added edge-case handling." },
        { ts: 1420, ts_end: 1510, observation: "Re-ran tests after refactor; all green." },
        { ts: 1680, ts_end: 1760, observation: "Added snapshot test for API response shape." },
        { ts: 1920, ts_end: 2010, observation: "Tests for duplicate articles in read history." },
        { ts: 2180, ts_end: 2260, observation: "npm test; fixed one timing-dependent test." },
        { ts: 2450, ts_end: 2540, observation: "Final test run before submit; all passing." },
      ],
    },
    {
      criterion: "Uses AI to plan before executing",
      score: 6,
      confidence: "medium",
      verdict: "Planned once at the start (3-step list); later asked for tests without outlining cases or steps first.",
      evaluable: true,
      evidence: [
        { ts: 15, ts_end: 55, observation: "Typed a 3-step plan in Composer: '1) endpoints, 2) recommendation fn, 3) wire up' before sending." },
        { ts: 150, ts_end: 210, observation: "Asked for tests without a plan: 'Write me some tests for the recommendation function.'" },
        { ts: 430, ts_end: 500, observation: "Brief note in prompt: 'need error handling next' before asking for code." },
        { ts: 680, ts_end: 740, observation: "Listed two API routes to implement before sending to Composer." },
        { ts: 920, ts_end: 980, observation: "No plan; direct ask: 'add validation for the request body'." },
        { ts: 1150, ts_end: 1220, observation: "Quick 1-2-3 list for refactor steps, then prompted." },
        { ts: 1380, ts_end: 1450, observation: "Asked for 'tests for the new helper' without outlining cases." },
        { ts: 1620, ts_end: 1700, observation: "Planned: 'first schema, then route, then test' before Composer." },
        { ts: 1880, ts_end: 1960, observation: "No written plan; single prompt for cleanup." },
        { ts: 2120, ts_end: 2200, observation: "Two-step note: 'fix the bug then add a test'." },
      ],
    },
    {
      criterion: "Gives specific directions to AI",
      score: 6,
      confidence: "medium",
      verdict: "One specific prompt with constraints; one vague prompt that only referenced the browser.",
      evaluable: true,
      evidence: [
        { ts: 48, ts_end: 100, observation: "Prompt included: 'Return max 3 recommendations, each with title and score. Use keyword overlap only.'" },
        { ts: 182, ts_end: 228, observation: "Browser-related prompt: 'Just make it work like the example from the page I have open' (no copy-paste of spec or URL)." },
        { ts: 340, ts_end: 400, observation: "Specific: 'Return 400 if userId is missing; use express-validator.'" },
        { ts: 550, ts_end: 620, observation: "Vague: 'make the test pass' without stating expected behavior." },
        { ts: 760, ts_end: 830, observation: "Clear: 'Limit to 10 articles per request; default sort by date desc.'" },
        { ts: 980, ts_end: 1050, observation: "Specified: 'Cover empty array and single-element array in the test.'" },
        { ts: 1200, ts_end: 1280, observation: "Gave field names and types for the response JSON." },
        { ts: 1480, ts_end: 1550, observation: "Asked for 'better error messages' without examples." },
        { ts: 1720, ts_end: 1800, observation: "Specific: 'Use 404 for not found, 422 for invalid input.'" },
        { ts: 1980, ts_end: 2060, observation: "Concrete: 'Recommendation algorithm: cosine similarity on keyword array.'" },
        { ts: 2240, ts_end: 2320, observation: "Mixed: one precise constraint, one 'like in the docs'." },
        { ts: 2500, ts_end: 2580, observation: "Final prompt: specific status codes and response shape." },
      ],
    },
    {
      criterion: "Ability to run multiple agents at once",
      score: 4,
      confidence: "high",
      verdict: "Used browser for docs instead of a second agent; ran tests in background once but did not combine Composer + Chat or two tasks.",
      evaluable: true,
      evidence: [
        { ts: 65, ts_end: 115, observation: "Composer request in progress; opened Chat in same workspace to ask about API shape." },
        { ts: 132, ts_end: 178, observation: "Switched to browser tab to check Express docs; did not ask agent or use a second agent for the same question." },
        { ts: 380, ts_end: 450, observation: "Single Composer session; no parallel Chat or second task." },
        { ts: 600, ts_end: 670, observation: "npm test running in terminal while editing a different file (no second agent)." },
        { ts: 850, ts_end: 920, observation: "Browser open on MDN; no agent used for the same lookup." },
        { ts: 1100, ts_end: 1170, observation: "One Composer conversation; waited for response before next action." },
        { ts: 1350, ts_end: 1420, observation: "Terminal and editor visible; no parallel agent usage." },
        { ts: 1580, ts_end: 1650, observation: "Brief Chat question while Composer idle (sequential, not parallel)." },
        { ts: 1820, ts_end: 1900, observation: "Browser tab for Jest docs; single agent workflow." },
        { ts: 2080, ts_end: 2160, observation: "Tests running; continued editing in same Composer thread only." },
        { ts: 2350, ts_end: 2430, observation: "Final stretch: linear flow, no multi-agent use." },
      ],
    },
  ],
};

// Extra dummy submissions (mixed statuses) for the same assessment
const DUMMY_SUBMISSIONS = [
  { candidateName: "Jordan Lee", candidateEmail: "jordan.lee@example.com", status: "pending" as const },
  { candidateName: "Sam Chen", candidateEmail: "sam.chen@example.com", status: "in-progress" as const },
  { candidateName: "Alex Rivera", candidateEmail: "alex.rivera@example.com", status: "submitted" as const },
  { candidateName: "Morgan Taylor", candidateEmail: "morgan.taylor@example.com", status: "submitted" as const },
  { candidateName: "Casey Kim", candidateEmail: "casey.kim@example.com", status: "pending" as const },
  { candidateName: "Riley Johnson", candidateEmail: "riley.johnson@example.com", status: "in-progress" as const },
  { candidateName: "Quinn Davis", candidateEmail: "quinn.davis@example.com", status: "submitted" as const },
  { candidateName: "Jamie Park", candidateEmail: "jamie.park@example.com", status: "submitted" as const },
  { candidateName: "Skyler Brooks", candidateEmail: "skyler.brooks@example.com", status: "pending" as const },
  { candidateName: "Taylor Reed", candidateEmail: "taylor.reed@example.com", status: "submitted" as const },
];

async function main() {
  try {
    await connectMongoose();

    let user = await UserModel.findOne({ email: DEMO_EMAIL }).lean();
    if (!user) {
      const uid = DEMO_FIREBASE_UID;
      await UserModel.create({
        firebaseUid: uid,
        email: DEMO_EMAIL,
        companyName: "Bridge",
      });
      user = await UserModel.findOne({ email: DEMO_EMAIL }).lean();
      console.log("Created user:", DEMO_EMAIL, "(firebaseUid:", uid + ")");
    } else {
      console.log("Using existing user:", DEMO_EMAIL);
    }

    if (!user) {
      console.error("Failed to get or create user");
      process.exit(1);
    }

    const userId = user._id;

    let assessment = await AssessmentModel.findOne({ userId }).sort({ createdAt: -1 }).lean();
    if (!assessment) {
      assessment = await AssessmentModel.create({
        userId,
        title: "Demo Assessment",
        description: "Take-home coding task with workflow evaluation. Submit your GitHub repo when done.",
        timeLimit: 60,
        evaluationCriteria: [
          "Uses AI to plan before executing",
          "Gives specific directions to AI",
          "Ability to run multiple agents at once",
          "Tests and debugs",
        ],
      });
      console.log("Created assessment:", (assessment as { _id: unknown; title: string }).title);
    } else {
      console.log("Using existing assessment:", assessment.title);
    }

    const assessmentId = assessment._id;

    const existingSubmission = await SubmissionModel.findOne({
      assessmentId,
      candidateEmail: DEMO_EMAIL,
    }).lean();

    const interviewPayload = {
      provider: "elevenlabs",
      status: "completed",
      transcript: DEMO_INTERVIEW_TRANSCRIPT,
      summary: DEMO_INTERVIEW_SUMMARY,
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      completedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existingSubmission) {
      await SubmissionModel.updateOne(
        { _id: existingSubmission._id },
        {
          $set: {
            status: "submitted",
            githubLink: "https://github.com/demo/candidate-repo",
            evaluationStatus: "completed",
            evaluationError: null,
            evaluationReport: DEMO_EVALUATION_REPORT,
            submittedAt: new Date(),
            timeSpent: 45,
            interview: interviewPayload,
          },
        }
      );
      console.log("Updated existing submission for", DEMO_EMAIL);
    } else {
      const token = crypto.randomBytes(32).toString("hex");
      await SubmissionModel.create({
        token,
        assessmentId,
        candidateName: "Saaz",
        candidateEmail: DEMO_EMAIL,
        status: "submitted",
        startedAt: new Date(Date.now() - 50 * 60 * 1000),
        submittedAt: new Date(),
        timeSpent: 45,
        githubLink: "https://github.com/demo/candidate-repo",
        evaluationStatus: "completed",
        evaluationReport: DEMO_EVALUATION_REPORT,
        interview: interviewPayload,
      });
      console.log("Created submission for", DEMO_EMAIL);
    }

    // Create or update dummy submissions (mixed statuses)
    const now = new Date();
    for (const dummy of DUMMY_SUBMISSIONS) {
      const existing = await SubmissionModel.findOne({
        assessmentId,
        candidateEmail: dummy.candidateEmail,
      }).lean();

      const basePayload = {
        assessmentId,
        candidateName: dummy.candidateName,
        candidateEmail: dummy.candidateEmail,
        status: dummy.status,
      };

      const isFailedEval = dummy.status === "submitted" && dummy.candidateEmail === "quinn.davis@example.com";
      const submittedPayload =
        dummy.status === "submitted"
          ? {
              startedAt: new Date(Date.now() - 55 * 60 * 1000),
              submittedAt: now,
              timeSpent: 38 + Math.floor(Math.random() * 20),
              githubLink: "https://github.com/demo/" + dummy.candidateEmail.split("@")[0].replace(".", "-"),
              evaluationStatus: isFailedEval ? ("failed" as const) : ("completed" as const),
              evaluationError: isFailedEval ? "Repo indexing timed out" : null,
            }
          : {};

      if (existing) {
        await SubmissionModel.updateOne(
          { _id: existing._id },
          {
            $set: {
              ...basePayload,
              ...(dummy.status === "in-progress"
                ? { startedAt: new Date(Date.now() - 25 * 60 * 1000) }
                : {}),
              ...submittedPayload,
            },
          }
        );
      } else {
        const token = crypto.randomBytes(32).toString("hex");
        await SubmissionModel.create({
          token,
          ...basePayload,
          startedAt:
            dummy.status === "pending"
              ? undefined
              : new Date(Date.now() - (dummy.status === "submitted" ? 55 : 25) * 60 * 1000),
          submittedAt: dummy.status === "submitted" ? now : undefined,
          timeSpent: dummy.status === "submitted" ? 38 + Math.floor(Math.random() * 20) : undefined,
          githubLink:
            dummy.status === "submitted"
              ? "https://github.com/demo/" + dummy.candidateEmail.split("@")[0].replace(".", "-")
              : undefined,
          ...(dummy.status === "submitted"
            ? {
                evaluationStatus: isFailedEval ? ("failed" as const) : ("completed" as const),
                evaluationError: isFailedEval ? "Repo indexing timed out" : null,
              }
            : {}),
        });
      }
    }
    console.log("Upserted", DUMMY_SUBMISSIONS.length, "dummy submissions.");

    console.log("Done. Log in as", DEMO_EMAIL, "and open the assessment submissions to see the demo.");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
