/**
 * Duplicate a submitted submission with the same content (repo, scores, candidate, etc.)
 * but replace the LLM trace with events from a JSON file.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/duplicateSubmissionWithTrace.ts <submissionIdOrAssessmentId> <traceFilePath>
 *
 * You can pass either:
 *   - A submission ID (the _id of the completed submission row), or
 *   - An assessment ID (e.g. from the URL: SubmissionsDashboard?assessmentId=...); the script will use the first submitted submission for that assessment.
 *
 * Example:
 *   npx tsx src/scripts/duplicateSubmissionWithTrace.ts 69655df877317e44ba02dfef /Users/austinflippo/Desktop/bridge_test/llm_interaction_trace.json
 *
 * Env: Ensure config.env (or ATLAS_URI) is loaded so the script can connect to MongoDB.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";
import crypto from "crypto";

function convertTraceFileToEvents(tracePath: string): {
  sessionId: string;
  events: Array<{
    timestamp: Date;
    type: string;
    prompt: string;
    response: string;
    tokens?: { input: number; output: number; total: number };
    latency?: number;
    cost?: number;
  }>;
} {
  const raw = readFileSync(tracePath, "utf-8");
  const data = JSON.parse(raw) as {
    conversations?: Array<{
      phase?: string;
      description?: string;
      deliverables?: string[];
      actions?: string[];
      issues?: string[];
    }>;
    events?: Array<{ prompt?: string; response?: string; [k: string]: unknown }>;
  };

  const sessionId = `session_dup_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

  if (Array.isArray(data.events) && data.events.length > 0) {
    const events = data.events.map((e) => ({
      timestamp: new Date(),
      type: "llm_call",
      prompt:
        typeof e.prompt === "string"
          ? e.prompt
          : e.input ?? e.user_input ?? e.content ?? "",
      response:
        typeof e.response === "string"
          ? e.response
          : e.output ?? e.assistant_output ?? e.content ?? "",
      tokens: { input: 0, output: 0, total: 0 },
      latency: 0,
      cost: 0,
    }));
    return { sessionId, events };
  }

  if (Array.isArray(data.conversations) && data.conversations.length > 0) {
    const events = data.conversations.map((c) => {
      const prompt = [c.phase, c.description].filter(Boolean).join(": ");
      const list = c.deliverables ?? c.actions ?? c.issues ?? [];
      const response = Array.isArray(list) ? list.join("\n") : String(list);
      return {
        timestamp: new Date(),
        type: "llm_call",
        prompt: prompt || "(no phase/description)",
        response: response || "(no deliverables/actions)",
        tokens: { input: 0, output: 0, total: 0 },
        latency: 0,
        cost: 0,
      };
    });
    return { sessionId, events };
  }

  throw new Error(
    "Trace file must contain an 'events' array or a 'conversations' array."
  );
}

async function main() {
  const sourceId = process.argv[2];
  const tracePath = process.argv[3];

  if (!sourceId || !tracePath) {
    console.error(
      "Usage: npx tsx src/scripts/duplicateSubmissionWithTrace.ts <submissionIdOrAssessmentId> <traceFilePath>"
    );
    process.exit(1);
  }

  try {
    console.log("🔄 Connecting to database...");
    await connectMongoose();
    console.log("✅ Connected to database");

    let source = await SubmissionModel.findById(sourceId).lean();
    if (!source) {
      console.log("   ID not found as submission; trying as assessment ID...");
      source = await SubmissionModel.findOne({
        assessmentId: sourceId,
        status: "submitted",
      })
        .sort({ submittedAt: -1 })
        .lean();
    }
    if (!source) {
      console.error("❌ No submission found. Use either (1) a submission _id or (2) an assessment id that has at least one submitted submission.");
      console.error("   Passed ID:", sourceId);
      process.exit(1);
    }
    if ((source as any).status !== "submitted") {
      console.error("❌ Source submission is not submitted. Only duplicating submitted submissions.");
      process.exit(1);
    }
    console.log("   Using submission:", (source as any)._id.toString());

    console.log("📄 Reading trace file:", tracePath);
    const { sessionId, events } = convertTraceFileToEvents(tracePath);
    console.log(`   Converted ${events.length} events for trace.`);

    const newToken = crypto.randomBytes(32).toString("hex");
    const traceEvents = events.map((e) => ({
      timestamp: e.timestamp,
      type: e.type,
      model: null,
      provider: null,
      prompt: e.prompt,
      response: e.response,
      tokens: e.tokens ?? { input: 0, output: 0, total: 0 },
      latency: e.latency ?? 0,
      cost: e.cost ?? 0,
      metadata: {},
    }));

    const totalTokens = traceEvents.reduce((s, e) => s + (e.tokens?.total ?? 0), 0);
    const totalCost = traceEvents.reduce((s, e) => s + (e.cost ?? 0), 0);
    const totalTime = traceEvents.reduce((s, e) => s + (e.latency ?? 0), 0);

    const duplicate: Record<string, unknown> = {
      token: newToken,
      assessmentId: (source as any).assessmentId,
      candidateName: (source as any).candidateName,
      candidateEmail: (source as any).candidateEmail,
      status: "submitted",
      startedAt: (source as any).startedAt,
      submittedAt: (source as any).submittedAt ?? new Date(),
      timeSpent: (source as any).timeSpent ?? 0,
      githubLink: (source as any).githubLink,
      githubRepo: (source as any).githubRepo,
      interviewQuestions: (source as any).interviewQuestions,
      interview: (source as any).interview,
      scores: (source as any).scores,
      llmWorkflow: {
        trace: {
          sessionId,
          events: traceEvents,
          totalTokens,
          totalCost,
          totalTime,
          totalCalls: traceEvents.length,
        },
        taskResults: (source as any).llmWorkflow?.taskResults ?? [],
        scores: (source as any).llmWorkflow?.scores ?? {},
        evaluation: (source as any).llmWorkflow?.evaluation ?? {
          harnessVersion: "1.0.0",
          tasksCompleted: 0,
          tasksTotal: 0,
          startedAt: (source as any).startedAt,
          completedAt: (source as any).submittedAt,
        },
      },
    };

    const created = await SubmissionModel.create(duplicate);
    console.log("\n✅ Duplicate submission created:");
    console.log("   New submission ID:", created._id.toString());
    console.log("   New token (for share link):", newToken);
    console.log("   Trace events:", traceEvents.length);
    console.log(
      "   Candidate link (open in app with token):",
      `?token=${newToken}`
    );
    console.log("   Use the same assessment's Submissions Dashboard to see the new submission.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
