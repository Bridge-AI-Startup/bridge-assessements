/**
 * One model call made through the candidate LLM proxy.
 *
 * This is the tamper-proof receipt, not the semantic record: grading still
 * reads the hook stream (WorkflowEvent), which the candidate's machine
 * produces and could in principle suppress. These rows are written server-side
 * in the request path the candidate cannot bypass without losing model access,
 * so cross-checking them against the hook stream is what makes the capture
 * record verifiable.
 *
 * Bodies are NOT stored whole — a Claude Code request re-sends the entire
 * conversation every call and can run to megabytes. We keep hashes + sizes
 * (enough to prove what flowed), the newest user text, and the response text,
 * both bounded.
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILlmProxyCall extends Document {
  submissionId: Types.ObjectId;
  at: Date;
  model: string;
  stream: boolean;
  /** Upstream HTTP status from Anthropic. */
  status: number;
  durationMs: number;
  usage: { input: number; output: number };
  requestBytes: number;
  responseBytes: number;
  requestSha256: string;
  responseSha256: string | null;
  /** Latest user-role text in the request (the "new" turn), truncated. */
  lastUserText: string | null;
  /** Assistant text of the response, truncated. */
  responseText: string | null;
  stopReason: string | null;
}

const llmProxyCallSchema = new Schema<ILlmProxyCall>({
  submissionId: {
    type: Schema.Types.ObjectId,
    ref: "Submission",
    required: true,
    index: true,
  },
  at: { type: Date, required: true },
  model: { type: String, default: "" },
  stream: { type: Boolean, default: false },
  status: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  usage: {
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
  },
  requestBytes: { type: Number, default: 0 },
  responseBytes: { type: Number, default: 0 },
  requestSha256: { type: String, default: "" },
  responseSha256: { type: String, default: null },
  lastUserText: { type: String, default: null },
  responseText: { type: String, default: null },
  stopReason: { type: String, default: null },
});

llmProxyCallSchema.index({ submissionId: 1, at: 1 });

export const LlmProxyCallModel =
  mongoose.models.LlmProxyCall ||
  mongoose.model<ILlmProxyCall>("LlmProxyCall", llmProxyCallSchema);

export default LlmProxyCallModel;
