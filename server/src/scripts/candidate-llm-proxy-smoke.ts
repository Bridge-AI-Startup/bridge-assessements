/**
 * Candidate LLM proxy smoke — end to end against a running local server.
 *
 *   cd server && npx tsx --env-file=config.env src/scripts/candidate-llm-proxy-smoke.ts
 *
 * Creates a throwaway assessment (with AI credits) + submission directly in
 * Mongo, then exercises the real HTTP surface exactly as the capture kit and
 * Claude Code do:
 *
 *   1. POST /api/workflow-capture/sessions  → capture token + llmProxy credential
 *   2. GET  /llm/usage                      → fresh budget
 *   3. POST /llm/v1/messages (non-stream)   → real Anthropic call, metered
 *   4. POST /llm/v1/messages (stream: true) → SSE passthrough, metered
 *   5. Budget slash → next call 429s (employer edit takes effect live)
 *   6. Receipt rows exist in LlmProxyCall
 *
 * Cleans up everything it created, pass or fail. Requires the dev server on
 * PORT (default 5050) and ANTHROPIC_API_KEY in config.env. Total model spend:
 * two haiku calls of ~30 tokens each.
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import LlmProxyCallModel from "../models/llmProxyCall.js";
import { WorkflowCaptureSessionModel, WorkflowEventModel } from "../models/workflowCapture.js";

const API = `http://localhost:${process.env.PORT || 5050}`;
const SMOKE_TAG = "[smoke] candidate-llm-proxy";

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  await connectMongoose();

  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`No server at ${API} — start it with: cd server && npm run dev`);
  }

  const assessment = await AssessmentModel.create({
    userId: new mongoose.Types.ObjectId(),
    title: `${SMOKE_TAG} ${new Date().toISOString()}`,
    description: "Throwaway assessment for the candidate LLM proxy smoke test.",
    timeLimit: 60,
    candidateLlmCredits: 100_000,
    evidenceMode: "both",
  });
  const submission = await SubmissionModel.create({
    assessmentId: assessment._id,
    candidateName: "Proxy Smoke",
    status: "in-progress",
  });
  let captureSessionId: string | null = null;

  try {
    // 1. Capture session creation issues the proxy credential
    const createRes = await fetch(`${API}/api/workflow-capture/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionToken: (submission as any).token,
        consentGranted: true,
        source: "claude-code",
      }),
    });
    assert(createRes.status === 201, `capture session created (${createRes.status})`);
    const created = await createRes.json();
    captureSessionId = created.sessionId;
    assert(created.llmProxy?.token, "response carries llmProxy.token (once)");
    assert(
      created.llmProxy.path === "/api/workflow-capture/llm",
      "llmProxy.path is the proxy base"
    );
    assert(created.llmProxy.creditBudget === 100_000, "creditBudget = assessment credits");

    const sub1: any = await SubmissionModel.findById(submission._id).lean();
    assert(sub1.llmProxy?.tokenHash, "only the hash is stored on the submission");
    assert(sub1.llmProxy.tokenHash !== created.llmProxy.token, "stored hash ≠ raw token");

    const bearer = { Authorization: `Bearer ${created.llmProxy.token}` };

    // 2. Usage starts fresh
    const usage0 = await (
      await fetch(`${API}/api/workflow-capture/llm/usage`, { headers: bearer })
    ).json();
    assert(usage0.creditBudget === 100_000 && usage0.tokensUsed === 0, "fresh meter");

    // 3. Non-streaming Messages call (what `claude -p` fallback paths send)
    const call1 = await fetch(`${API}/api/workflow-capture/llm/v1/messages`, {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        messages: [{ role: "user", content: "Say OK and nothing else." }],
      }),
    });
    const body1 = await call1.json();
    assert(call1.status === 200, `non-stream call forwarded (${call1.status})`);
    assert(
      Array.isArray(body1.content) && body1.usage?.output_tokens > 0,
      "real Anthropic response relayed"
    );

    const usage1 = await (
      await fetch(`${API}/api/workflow-capture/llm/usage`, { headers: bearer })
    ).json();
    assert(usage1.tokensUsed > 0, `metered non-stream usage (${usage1.tokensUsed} tokens)`);
    assert(usage1.calls === 1, "call counter incremented");

    // 4. Streaming Messages call (what Claude Code actually sends)
    const call2 = await fetch(`${API}/api/workflow-capture/llm/v1/messages`, {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        stream: true,
        messages: [{ role: "user", content: "Say OK and nothing else." }],
      }),
    });
    assert(call2.status === 200, `stream call forwarded (${call2.status})`);
    const sse = await call2.text();
    assert(sse.includes("message_start"), "SSE stream relayed");

    const usage2 = await (
      await fetch(`${API}/api/workflow-capture/llm/usage`, { headers: bearer })
    ).json();
    assert(
      usage2.tokensUsed > usage1.tokensUsed,
      `metered stream usage (${usage2.tokensUsed} total tokens)`
    );

    // 5. Employer edit applies live: slash the budget below usage → 429
    await AssessmentModel.updateOne(
      { _id: assessment._id },
      { $set: { candidateLlmCredits: 1 } }
    );
    const call3 = await fetch(`${API}/api/workflow-capture/llm/v1/messages`, {
      method: "POST",
      headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    assert(call3.status === 429, `exhausted budget refused (${call3.status})`);
    const refusal = await call3.json();
    assert(refusal.error === "credit_budget_exceeded", "429 names the reason");

    // 6. Receipts exist with hashes + usage
    const receipts: any[] = await LlmProxyCallModel.find({
      submissionId: submission._id,
    }).lean();
    assert(receipts.length === 2, `2 receipt rows written (${receipts.length})`);
    assert(
      receipts.every((r) => /^[0-9a-f]{64}$/.test(r.requestSha256)),
      "receipts carry request hashes"
    );
    assert(
      receipts.some((r) => r.stream) && receipts.some((r) => !r.stream),
      "both stream and non-stream receipts present"
    );
    assert(
      receipts.every((r) => r.usage.input + r.usage.output > 0),
      "receipts carry usage"
    );

    // Bad token is refused
    const bad = await fetch(`${API}/api/workflow-capture/llm/usage`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert(bad.status === 403, "unknown token refused");

    console.log("\n✅ candidate LLM proxy smoke passed\n");
  } finally {
    await LlmProxyCallModel.deleteMany({ submissionId: submission._id });
    if (captureSessionId) {
      await WorkflowEventModel.deleteMany({ sessionId: captureSessionId });
      await WorkflowCaptureSessionModel.deleteOne({ _id: captureSessionId });
    }
    await SubmissionModel.deleteOne({ _id: submission._id });
    await AssessmentModel.deleteOne({ _id: assessment._id });
    console.log("🧹 smoke data cleaned up");
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
