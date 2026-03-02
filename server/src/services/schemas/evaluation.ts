/**
 * Zod schemas for transcript evaluation.
 */

import { z } from "zod";

export const evidenceItemSchema = z.object({
  ts: z.number().describe("Start timestamp in seconds of the observed event"),
  ts_end: z.number().describe("End timestamp in seconds of the observed event"),
  observation: z.string().describe("What was observed at this timestamp that is relevant to the criterion"),
});

export const criterionResultSchema = z.object({
  criterion: z.string().describe("The original criterion text"),
  evidence: z.array(evidenceItemSchema).describe("Specific timestamped moments from the transcript that support the verdict. Always populate this before deciding the score."),
  score: z.number().int().min(1).max(10).describe("Score from 1-10 based on the evidence found"),
  confidence: z.enum(["high", "medium", "low"]).describe("high: multiple clear evidence moments. medium: some evidence but incomplete. low: little or no direct evidence in the transcript."),
  verdict: z.string().describe("One paragraph human-readable summary of why this score was given, referencing specific moments from the transcript"),
});

export type CriterionResultSchema = z.infer<typeof criterionResultSchema>;

export const validationResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string().optional()
});

export const groundedCriterionSchema = z.object({
  original: z.string().describe("The original criterion text as supplied by the caller"),
  definition: z.string().describe("A clear, concise definition of what this criterion means in the context of a hiring assessment"),
  positive_indicators: z.array(z.string()).describe("Observable behaviors or actions that are evidence the candidate meets this criterion"),
  negative_indicators: z.array(z.string()).describe("Observable behaviors or actions that are evidence the candidate does not meet this criterion"),
  relevant_action_types: z.array(z.enum(["ai_prompt", "ai_response", "coding", "testing", "reading", "searching", "idle"])).describe("The action types from the transcript that are most relevant to evaluating this criterion"),
});

export type GroundedCriterionSchema = z.infer<typeof groundedCriterionSchema>;
