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

// ============================================================================
// Activity Interpreter schemas
// ============================================================================

/** Raw LLM output event — uses moment indices instead of timestamps. */
export const llmEventSchema = z.object({
  moment_range: z.tuple([z.number().int(), z.number().int()]).describe("[start_index, end_index] inclusive — which moments this event covers"),
  behavioral_summary: z.string().describe("1-2 sentence description of what the candidate is doing, not what is on screen"),
  intent: z.string().describe("Freeform intent label, e.g. 'debugging', 'asking AI for full solution', 'reading problem constraints'"),
  ai_tool: z.string().nullable().describe("AI tool being used if any: 'cursor', 'claude', 'chatgpt', 'copilot', or null"),
});

export type LlmEventSchema = z.infer<typeof llmEventSchema>;

/** Final enriched event with computed timestamps (produced in code, not by the LLM). */
export const enrichedEventSchema = z.object({
  ts: z.number().min(0).describe("Start timestamp in seconds since session start"),
  ts_end: z.number().min(0).describe("End timestamp in seconds since session start"),
  behavioral_summary: z.string().describe("1-2 sentence description of what the candidate is doing, not what is on screen"),
  intent: z.string().describe("Freeform intent label, e.g. 'debugging', 'asking AI for full solution', 'reading problem constraints'"),
  ai_tool: z.string().nullable().describe("AI tool being used if any: 'cursor', 'claude', 'chatgpt', 'copilot', or null"),
});

export type EnrichedEventSchema = z.infer<typeof enrichedEventSchema>;

export const interpreterBatchOutputSchema = z.object({
  events: z.array(llmEventSchema).describe("Behavioral events referencing moment indices"),
  running_summary: z.string().describe("Updated running summary of the full session so far, to carry forward to the next batch"),
});

export type InterpreterBatchOutputSchema = z.infer<typeof interpreterBatchOutputSchema>;

export const activityBoundariesSchema = z.object({
  chunks: z.array(z.object({
    start_moment: z.number().describe("Index of the first moment in this chunk (0-based)"),
    end_moment: z.number().describe("Index of the last moment in this chunk (inclusive, 0-based)"),
    label: z.string().describe("Short label for the activity phase, e.g. 'reading problem', 'debugging cycle', 'AI-assisted refactoring'"),
  })).describe("Activity chunks covering all moments, in order"),
});

export type ActivityBoundariesSchema = z.infer<typeof activityBoundariesSchema>;

export const llmJudgeScoreSchema = z.object({
  accuracy: z.number().min(1).max(5).describe("Does the behavioral description match the raw OCR? No hallucinated actions. 1=many hallucinations, 5=fully accurate"),
  specificity: z.number().min(1).max(5).describe("Is the description precise or vague? 1=very vague, 5=very specific"),
  behavioral_insight: z.number().min(1).max(5).describe("Does it describe what the candidate is DOING vs just what is on screen? 1=screen description only, 5=rich behavioral insight"),
  justification: z.string().describe("Brief explanation of the scores"),
});

export type LlmJudgeScoreSchema = z.infer<typeof llmJudgeScoreSchema>;
