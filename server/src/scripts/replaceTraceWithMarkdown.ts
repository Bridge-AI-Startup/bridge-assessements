/**
 * Replace an existing submission's LLM trace with events parsed from a markdown file.
 * Updates the submission in place (no duplicate).
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/replaceTraceWithMarkdown.ts <submissionId> <markdownFilePath>
 *
 * Markdown format: ## User / ## Assistant sections and optional metadata block
 * (total_tokens, total_cost, total_time_seconds or total_time_ms) at the end.
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";
import { parseTraceMarkdown } from "../utils/fileUpload.js";
import crypto from "crypto";

async function main() {
  const submissionId = process.argv[2];
  const markdownPath = process.argv[3];

  if (!submissionId || !markdownPath) {
    console.error(
      "Usage: npx tsx src/scripts/replaceTraceWithMarkdown.ts <submissionId> <markdownFilePath>"
    );
    process.exit(1);
  }

  try {
    await connectMongoose();

    const submission = await SubmissionModel.findById(submissionId).lean();
    if (!submission) {
      console.error("Submission not found:", submissionId);
      process.exit(1);
    }

    const content = readFileSync(markdownPath);
    const parsed = parseTraceMarkdown({ buffer: content } as Express.Multer.File);

    const sessionId =
      (submission as any).llmWorkflow?.trace?.sessionId ||
      `session_replace_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    const totalTokens =
      parsed.sessionMetadata?.totalTokens ??
      parsed.events.reduce(
        (s, e) => s + (e.tokens?.total ?? (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0)),
        0
      );
    const totalCost =
      parsed.sessionMetadata?.totalCost ??
      parsed.events.reduce((s, e) => s + (e.cost ?? 0), 0);
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

    await SubmissionModel.updateOne(
      { _id: submissionId },
      {
        $set: {
          "llmWorkflow.trace": {
            sessionId,
            events: traceEvents,
            totalTokens,
            totalCost,
            totalTime: totalTimeMs,
            totalCalls: traceEvents.length,
          },
        },
      }
    );

    console.log("Replaced trace for submission:", submissionId);
    console.log("  events:", traceEvents.length);
    console.log("  totalTokens:", totalTokens);
    console.log("  totalCost:", totalCost);
    console.log("  totalTimeMs:", totalTimeMs);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
