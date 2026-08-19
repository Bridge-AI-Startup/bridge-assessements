/**
 * Create a MERN runtime-setup demo assessment under the Bridge demo recruiter
 * and print a candidate share link.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedRuntimeSetupMernDemo.ts
 *
 * Submit folder: ../../demos/runtime-setup-mern
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
const TITLE = "MERN Notes Board";
const CANDIDATE_EMAIL = "runtime.setup.tester@example.com";
const CANDIDATE_NAME = "Runtime Setup Tester";

const DESCRIPTION = `Build a small notes board with the MERN stack.

## Product
A single-page app where a user can add notes, mark them done, and delete them. The React client talks to an Express API. Persist notes in MongoDB when a connection string is available.

## Must-haves
- \`GET /health\` returns 200 with \`{ ok: true }\`
- \`GET /api/notes\` lists notes (newest first)
- \`POST /api/notes\` with \`{ title }\` creates a note
- \`PATCH /api/notes/:id\` can toggle \`done\`
- \`DELETE /api/notes/:id\` removes a note
- The built React client is served by the same process as the API

## How to run
Install: \`npm install && npm run build\`
Start: \`npm start\`
Port: \`5050\`
Health: \`/health\`

MongoDB is optional. If \`MONGO_URI\` is unset, an in-memory store is fine.
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
    timeLimit: 60,
    numInterviewQuestions: 2,
    isSmartInterviewerEnabled: false,
    evidenceMode: "both",
    behavioralChecks: [
      "A visitor can add a note and see it in the list without refreshing.",
      "Checking a note off marks it done and that state survives a page reload.",
      "Deleting a note removes it from the list.",
      "GET /health returns a successful JSON payload.",
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
  console.log("  demos/runtime-setup-mern");
  console.log("\nSuggested runtime config after submit:");
  console.log("  install : npm install && npm run build");
  console.log("  start   : npm start");
  console.log("  port    : 5050");
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
