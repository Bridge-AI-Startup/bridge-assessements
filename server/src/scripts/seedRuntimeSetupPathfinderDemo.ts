/**
 * Create a Python pathfinder runtime-setup demo assessment under the Bridge
 * demo recruiter and print a candidate share link.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedRuntimeSetupPathfinderDemo.ts
 *
 * Submit folder: ../../demos/runtime-setup-pathfinder
 */
import "../config/loadEnv.js";
import crypto from "crypto";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import UserModel from "../models/user.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import { getShareLinkBaseUrl } from "../utils/shareLink.js";

const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@bridgeai-demo.com").toLowerCase();
const TITLE = "Warehouse Pathfinder";
const CANDIDATE_EMAIL = "runtime.pathfinder.tester@example.com";
const CANDIDATE_NAME = "Pathfinder Tester";

const DESCRIPTION = `Write a Python 3 pathfinder for a warehouse floor (stdlib only).

## Product
A grid map uses \`S\` for the dock, \`P\` for packages, \`#\` for walls, and \`.\` for floor. Collect every package and return to the dock. Pairwise distances should use A* (4-connected). Visit order should be an exact TSP over those distances (Held-Karp is enough for the toy maps).

Ship a CLI **and** a tiny HTTP UI so a recruiter can watch a solve.

## Must-haves
- \`python3 solve.py maps/small.txt\` prints a tour and exits 0
- \`python3 solve.py maps/blocked.txt\` reports the unreachable package and exits 1
- \`python3 app.py\` serves the UI on \`PORT\` (default 8000)
- \`GET /health\` returns 200 with \`{ ok: true }\`
- \`GET /api/solve?map=small\` returns JSON with a path that visits every package and returns to \`S\`

## How to run
Install: _(none — stdlib only)_
Start: \`python3 app.py\`
Port: \`8000\`
Health: \`/health\`
`;

async function main() {
  await connectMongoose();

  const user = await UserModel.findOne({ email: DEMO_EMAIL });
  if (!user) {
    throw new Error(
      `No user for ${DEMO_EMAIL}. The login-ready demo account is demo@bridgeai-demo.com.`
    );
  }

  let assessment = await AssessmentModel.findOne({
    userId: user._id,
    title: TITLE,
  });

  const payload = {
    userId: user._id,
    title: TITLE,
    description: DESCRIPTION,
    timeLimit: 75,
    numInterviewQuestions: 2,
    isSmartInterviewerEnabled: false,
    evidenceMode: "screen",
    behavioralChecks: [
      "python3 solve.py maps/small.txt prints a path and exits 0.",
      "The HTTP UI can solve the small map and animate a path that returns to the dock.",
      "GET /health returns a successful JSON payload.",
      "An unreachable package on maps/blocked.txt is reported instead of hanging.",
    ],
    evaluationCriteria: [
      "Uses AI to plan before executing",
      "Tests and debugs",
    ],
  };

  if (assessment) {
    await AssessmentModel.updateOne({ _id: assessment._id }, { $set: payload });
    assessment = await AssessmentModel.findById(assessment._id);
    console.log("Updated assessment:", TITLE);
  } else {
    assessment = await AssessmentModel.create(payload);
    console.log("Created assessment:", TITLE);
  }

  let submission = await SubmissionModel.findOne({
    assessmentId: assessment._id,
    candidateEmail: CANDIDATE_EMAIL,
  });

  if (!submission) {
    submission = await SubmissionModel.create({
      token: crypto.randomBytes(32).toString("hex"),
      assessmentId: assessment._id,
      candidateName: CANDIDATE_NAME,
      candidateEmail: CANDIDATE_EMAIL,
      status: "pending",
    });
    console.log("Created candidate submission");
  } else if (submission.status === "submitted" || submission.status === "expired") {
    console.log(
      "Existing tester submission is already",
      submission.status,
      "— leaving it. Open RuntimeSetup with that token, or create a new candidate from the editor."
    );
  } else {
    console.log("Reusing pending/in-progress tester submission");
  }

  const shareLink = `${getShareLinkBaseUrl()}/CandidateAssessment?token=${submission.token}`;
  const setupLink = `${getShareLinkBaseUrl()}/RuntimeSetup?token=${submission.token}`;

  console.log("\nEmployer");
  console.log("  account   :", DEMO_EMAIL);
  console.log("  assessment:", String(assessment._id), TITLE);
  console.log("\nCandidate");
  console.log("  name      :", CANDIDATE_NAME);
  console.log("  token     :", submission.token);
  console.log("  start     :", shareLink);
  console.log("  setup     :", setupLink, "(after submit)");
  console.log("\nSubmit this folder (zip the contents, not the parent):");
  console.log("  demos/runtime-setup-pathfinder");
  console.log("\nSuggested runtime config after submit:");
  console.log("  runtime : python312");
  console.log("  install : (empty)");
  console.log("  start   : python3 app.py");
  console.log("  port    : 8000");
  console.log("  health  : /health");
  console.log("\nSet RUNTIME_SETUP_ENABLED=true in server/config.env, then restart the API.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
