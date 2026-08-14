/**
 * 10-minute Guestbook smoke assessment — E2B grading + evidenceMode both
 * (screen + capture-kit). Upserts under Saaz and the demo recruiter and
 * prints a candidate share link for each.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedGuestbookSmoke.ts
 *
 * Owners (override with OWNER_EMAILS=comma,separated):
 *   saaz.m@icloud.com, demo@bridgeai-demo.com
 *
 * Take the assessment as a candidate (implement POST /api/messages), or skip
 * the coding and zip-upload the completed folder:
 *   demos/guestbook-smoke
 */
import "../config/loadEnv.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import UserModel from "../models/user.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import { getShareLinkBaseUrl } from "../utils/shareLink.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.resolve(__dirname, "../../../demos/guestbook-smoke");

const TITLE = "Guestbook (10-min smoke)";
const CANDIDATE_EMAIL = "guestbook.smoke@example.com";
const CANDIDATE_NAME = "Guestbook Smoke Tester";
const OWNER_EMAILS = (
  process.env.OWNER_EMAILS || "saaz.m@icloud.com,demo@bridgeai-demo.com"
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const DESCRIPTION = `Finish a tiny guestbook in about 10 minutes.

## Product
One Express process serves a page and a messages API. No database. A visitor types a message, clicks Add, and sees it in the list.

## Starter
Unzip the starter. \`GET /health\` and \`GET /api/messages\` already work. The page is wired. \`POST /api/messages\` is stubbed and returns 501 — that is the work.

## Must-haves
- \`GET /health\` returns 200 with \`{ ok: true }\`
- \`POST /api/messages\` with \`{ text }\` creates a message (400 if text is blank)
- \`GET /api/messages\` lists messages, newest first
- Adding a message on the page shows it in the list without a manual refresh

## How to run
Install: \`npm install\`
Start: \`npm start\`
Port: \`3000\` (or \`PORT\`)
Health: \`/health\`
`;

const CHECKS = [
  "GET /health returns 200 with { ok: true }.",
  "POST /api/messages creates a message and GET /api/messages lists it.",
  "A visitor can add a message and see it in the list without refreshing.",
] as const;

const CHECK_SPECS = [
  {
    id: "health",
    text: CHECKS[0],
    kind: "http" as const,
    acceptance: {
      request: { method: "GET" as const, path: "/health" },
      expect: { status: [200], bodyContains: ['"ok":true'] },
    },
  },
  {
    id: "create-api",
    text: CHECKS[1],
    kind: "http_sequence" as const,
    acceptance: {
      steps: [
        {
          label: "create",
          request: {
            method: "POST" as const,
            path: "/api/messages",
            json: { text: "{{nonce}}" },
          },
          expect: { status: [200, 201], bodyContains: ["{{nonce}}"] },
        },
        {
          label: "list",
          request: { method: "GET" as const, path: "/api/messages" },
          expect: { status: [200], bodyContains: ["{{nonce}}"] },
        },
      ],
    },
  },
  {
    id: "create-ui",
    text: CHECKS[2],
    kind: "ui" as const,
    acceptance: {
      steps: [
        { action: "goto" as const, path: "/" },
        {
          action: "fill_placeholder" as const,
          placeholder: "Write a message",
          value: "{{nonce}}",
        },
        { action: "click_role" as const, role: "button" as const, name: "Add", exact: true },
        { action: "expect_text" as const, text: "{{nonce}}" },
      ],
    },
  },
];

const STARTER_SERVER_JS = `const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const messages = [];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/messages", (_req, res) => {
  res.status(200).json({ messages });
});

app.post("/api/messages", (req, res) => {
  // TODO: save the message and return it.
  // Body is { text: string }. Reject a blank text with 400.
  // On success, return 201 and { message: { id, text, createdAt } }.
  // Newest messages should appear first on GET /api/messages.
  res.status(501).json({ error: "not_implemented" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(\`guestbook http://0.0.0.0:\${PORT}\`);
});
`;

function readDemoFile(relPath: string): string {
  return fs.readFileSync(path.join(DEMO_DIR, relPath), "utf8");
}

function starterCodeFiles(): Array<{ path: string; content: string }> {
  return [
    { path: "README.md", content: readDemoFile("README.md") },
    { path: "package.json", content: readDemoFile("package.json") },
    { path: ".gitignore", content: readDemoFile(".gitignore") },
    { path: "public/index.html", content: readDemoFile("public/index.html") },
    { path: "server.js", content: STARTER_SERVER_JS },
  ];
}

async function upsertForUser(
  user: { _id: unknown; email?: string },
  files: Array<{ path: string; content: string }>
) {
  let assessment = await AssessmentModel.findOne({
    userId: user._id,
    title: TITLE,
  });

  const payload = {
    userId: user._id,
    title: TITLE,
    description: DESCRIPTION,
    timeLimit: 10,
    evidenceMode: "both",
    starterCodeFiles: files,
    behavioralChecks: [...CHECKS],
    behavioralCheckSpecs: CHECK_SPECS,
    evaluationCriteria: [
      "Inspects existing project files before the first edit",
      "Edits or rewrites agent-written code rather than leaving it untouched",
      "Runs the app to check a change before moving on",
    ],
  };

  if (assessment) {
    await AssessmentModel.updateOne({ _id: assessment._id }, { $set: payload });
    assessment = await AssessmentModel.findById(assessment._id);
    console.log("Updated assessment for", user.email);
  } else {
    assessment = await AssessmentModel.create(payload);
    console.log("Created assessment for", user.email);
  }

  if (!assessment) {
    throw new Error(`Failed to load assessment after upsert for ${user.email}`);
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
    console.log("  created candidate submission");
  } else if (submission.status === "submitted" || submission.status === "expired") {
    submission = await SubmissionModel.create({
      token: crypto.randomBytes(32).toString("hex"),
      assessmentId: assessment._id,
      candidateName: CANDIDATE_NAME,
      candidateEmail: `${Date.now()}.${CANDIDATE_EMAIL}`,
      status: "pending",
    });
    console.log("  previous tester link was already used — created a fresh pending one");
  } else {
    console.log("  reusing pending/in-progress tester submission");
  }

  const shareLink = `${getShareLinkBaseUrl()}/CandidateAssessment?token=${submission.token}`;
  const setupLink = `${getShareLinkBaseUrl()}/RuntimeSetup?token=${submission.token}`;
  const dashboard = `${getShareLinkBaseUrl()}/SubmissionsDashboard?assessmentId=${assessment._id}`;

  return {
    email: user.email,
    assessmentId: String(assessment._id),
    token: submission.token,
    shareLink,
    setupLink,
    dashboard,
  };
}

async function main() {
  await connectMongoose();
  const files = starterCodeFiles();
  const results = [];

  for (const email of OWNER_EMAILS) {
    const user = await UserModel.findOne({ email });
    if (!user) {
      console.warn("Skipping missing recruiter:", email);
      continue;
    }
    results.push(await upsertForUser(user, files));
  }

  if (!results.length) {
    throw new Error(
      `No recruiters found. Tried: ${OWNER_EMAILS.join(", ")}. Sign in once, or set OWNER_EMAILS.`
    );
  }

  for (const row of results) {
    console.log("\nEmployer");
    console.log("  account   :", row.email);
    console.log("  assessment:", row.assessmentId, TITLE);
    console.log("  dashboard :", row.dashboard);
    console.log("Candidate (10 min, Observe session on)");
    console.log("  start     :", row.shareLink);
    console.log("  setup     :", row.setupLink, "(after submit, if runtime setup is on)");
  }

  console.log("\nWork: implement POST /api/messages in the starter zip.");
  console.log("Or skip coding and zip-upload this completed folder:");
  console.log("  demos/guestbook-smoke");
  console.log("\nSuggested runtime config after submit:");
  console.log("  install : npm install");
  console.log("  start   : npm start");
  console.log("  port    : 3000");
  console.log("  health  : /health");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
