/**
 * Delete a submission (with bad markdown trace) and create a new one with the same
 * info but trace from the generated markdown file. Use the generated job-recommendation
 * conversation (good trace with tokens/cost/time) instead of the bad Cursor export.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/replaceSubmissionWithGeneratedMarkdown.ts <submissionToken> [markdownFilePath]
 *
 * Example:
 *   npx tsx src/scripts/replaceSubmissionWithGeneratedMarkdown.ts 1995b9bf77e73d9f5f85d2b70ee60bc1f4e3364c546bdb211536c6cb4c3c62fe
 *   npx tsx src/scripts/replaceSubmissionWithGeneratedMarkdown.ts 1995b9bf... 69655df877317e44ba02dfef
 *
 * Default markdown path: 69655df877317e44ba02dfef (generated dummy conversation in server dir)
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import { join } from "path";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";
import { parseTraceMarkdown } from "../utils/fileUpload.js";
import crypto from "crypto";

async function main() {
  const token = process.argv[2]?.trim();
  const markdownPathArg = process.argv[3]?.trim();
  const markdownPath = markdownPathArg
    ? join(process.cwd(), markdownPathArg)
    : join(process.cwd(), "69655df877317e44ba02dfef");

  if (!token) {
    console.error(
      "Usage: npx tsx src/scripts/replaceSubmissionWithGeneratedMarkdown.ts <submissionToken> [markdownFilePath]"
    );
    process.exit(1);
  }

  try {
    await connectMongoose();

    const oldSubmission = await SubmissionModel.findOne({ token }).lean();
    if (!oldSubmission) {
      console.error("No submission found for token:", token.slice(0, 12) + "...");
      process.exit(1);
    }

    const content = readFileSync(markdownPath);
    const parsed = parseTraceMarkdown({ buffer: content } as Express.Multer.File);

    const sessionId = `session_new_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const totalTokens =
      parsed.sessionMetadata?.totalTokens ??
      parsed.events.reduce(
        (s, e) => s + (e.tokens?.total ?? (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0)),
        0
      );
    const totalCost =
      parsed.sessionMetadata?.totalCost ?? parsed.events.reduce((s, e) => s + (e.cost ?? 0), 0);
    const totalTimeMs =
      parsed.sessionMetadata?.totalTimeMs ??
      parsed.events.reduce((s, e) => s + (e.latency ?? 0), 0);

    const traceEvents = parsed.events.map((e) => ({
      timestamp: new Date(),
      type: "llm_call",
      model: null,
      provider: null,
      prompt: e.prompt,
      response: e.response,
      tokens: {
        input: e.tokens?.input ?? 0,
        output: e.tokens?.output ?? 0,
        total: e.tokens?.total ?? 0,
      },
      latency: e.latency ?? 0,
      cost: e.cost ?? 0,
      metadata: {},
    }));

    const newToken = crypto.randomBytes(32).toString("hex");
    const s = oldSubmission as any;

    const newSubmission = {
      token: newToken,
      assessmentId: s.assessmentId,
      candidateName: s.candidateName,
      candidateEmail: s.candidateEmail,
      status: "submitted",
      startedAt: s.startedAt,
      submittedAt: s.submittedAt ?? new Date(),
      timeSpent: s.timeSpent ?? 0,
      githubLink: s.githubLink,
      githubRepo: s.githubRepo,
      interviewQuestions: s.interviewQuestions,
      interview: s.interview,
      scores: s.scores,
      llmWorkflow: {
        trace: {
          sessionId,
          events: traceEvents,
          totalTokens,
          totalCost,
          totalTime: totalTimeMs,
          totalCalls: traceEvents.length,
        },
        taskResults: s.llmWorkflow?.taskResults ?? [],
        scores: {}, // reset so workflow can be recalculated
        evaluation: s.llmWorkflow?.evaluation ?? {
          harnessVersion: "1.0.0",
          tasksCompleted: 0,
          tasksTotal: 0,
          startedAt: s.startedAt,
          completedAt: s.submittedAt,
        },
      },
    };

    const created = await SubmissionModel.create(newSubmission);
    const oldId = s._id.toString();
    await SubmissionModel.deleteOne({ _id: oldId });

    console.log("✅ Replaced submission with generated markdown trace.");
    console.log("   Deleted submission ID:", oldId);
    console.log("   New submission ID:", created._id.toString());
    console.log("   New token:", newToken);
    console.log("   Trace events:", traceEvents.length, "| totalTokens:", totalTokens, "| totalCost:", totalCost, "| totalTimeMs:", totalTimeMs);
    console.log("   Candidate link: CandidateSubmitted?token=" + newToken);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
