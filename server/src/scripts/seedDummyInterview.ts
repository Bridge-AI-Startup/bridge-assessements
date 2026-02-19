/**
 * Seed a submission with dummy voice interview transcript and mark interview completed.
 * Use when you want to move past the voice interview step without doing the real call.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/seedDummyInterview.ts <submissionToken>
 *
 * Example (token from CandidateSubmitted URL):
 *   npx tsx src/scripts/seedDummyInterview.ts 1995b9bf77e73d9f5f85d2b70ee60bc1f4e3364c546bdb211536c6cb4c3c62fe
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";
import crypto from "crypto";

function buildDummyTranscript(): Array<{
  role: "agent" | "candidate";
  text: string;
  startMs?: number;
  endMs?: number;
}> {
  const now = Date.now();
  const turns: Array<{ role: "agent" | "candidate"; text: string; startMs?: number; endMs?: number }> = [];
  let t = 0;

  const pairs: [string, string][] = [
    [
      "Thanks for joining. Can you walk me through how you approached the job recommendation feature?",
      "I started by setting up the MERN stack and then built the backend API for user preferences and job matching. I implemented a simple scoring algorithm that ranks jobs based on title, location, and salary range.",
    ],
    [
      "How did you handle authentication and storing user preferences?",
      "I used JWT for auth and MongoDB to store user preferences. The preferences form captures job title, location, salary range, and job type, and that gets saved to the UserPreference model linked to the user.",
    ],
    [
      "What was the trickiest part of the implementation?",
      "Getting the scoring weights right so that matches felt relevant. I went with 40 for title match, 30 for location, 20 for salary, and 10 for job type, and tuned based on the sample data.",
    ],
    [
      "Did you add any tests or validation?",
      "Yes, I added unit tests for the scoring algorithm and validation on the preference form and API. I also included a quick validation script and README with setup instructions.",
    ],
    [
      "That covers what I needed. Thank you for your time. This completes our interview.",
      "Thank you. Happy to discuss more if needed.",
    ],
  ];

  for (const [agentText, candidateText] of pairs) {
    turns.push({
      role: "agent",
      text: agentText,
      startMs: now + t,
      endMs: now + t + 3000,
    });
    t += 4000;
    turns.push({
      role: "candidate",
      text: candidateText,
      startMs: now + t,
      endMs: now + t + 5000,
    });
    t += 6000;
  }

  return turns;
}

const DUMMY_SUMMARY =
  "The candidate discussed their approach to the job recommendation feature. They set up a MERN stack, implemented JWT auth and MongoDB for user preferences, and built a scoring algorithm (40/30/20/10 for title, location, salary, job type). They added unit tests, form and API validation, and documentation. The interview concluded with a brief recap and thank you.";

async function main() {
  const token = process.argv[2]?.trim();

  if (!token) {
    console.error("Usage: npx tsx src/scripts/seedDummyInterview.ts <submissionToken>");
    console.error("  Get the token from the URL: .../CandidateSubmitted?token=...");
    process.exit(1);
  }

  try {
    await connectMongoose();

    const submission = await SubmissionModel.findOne({ token }).lean();
    if (!submission) {
      console.error("No submission found for token:", token.slice(0, 12) + "...");
      process.exit(1);
    }

    const turns = buildDummyTranscript();
    const conversationId = `dummy_${crypto.randomBytes(8).toString("hex")}`;
    const startedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const completedAt = new Date();

    await SubmissionModel.updateOne(
      { token },
      {
        $set: {
          "interview.provider": "elevenlabs",
          "interview.status": "completed",
          "interview.conversationId": conversationId,
          "interview.transcript": { turns },
          "interview.summary": DUMMY_SUMMARY,
          "interview.startedAt": startedAt,
          "interview.completedAt": completedAt,
          "interview.updatedAt": completedAt,
        },
      }
    );

    console.log("✅ Dummy interview saved for submission (token:", token.slice(0, 12) + "...)");
    console.log("   Turns:", turns.length);
    console.log("   Status: completed");
    console.log("   Refresh the CandidateSubmitted page to see 'Interview Completed' and move to the next stage.");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
