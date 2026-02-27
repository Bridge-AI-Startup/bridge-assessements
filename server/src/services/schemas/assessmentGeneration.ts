/**
 * Zod schemas for assessment generation.
 * - Assessment output: final title, description, timeLimit.
 * - Requirements extraction: summary, stack, level, confidence (Step 1).
 */

import { z } from "zod";

const assessmentStackSchema = z.enum([
  "frontend-react",
  "frontend-vue",
  "backend-node",
  "backend-python",
  "mobile-react-native",
  "fullstack",
  "generic",
]);

const roleLevelSchema = z.enum(["junior", "mid", "senior"]);

const routingConfidenceSchema = z.enum(["high", "medium", "low"]);

/** Final assessment output (Step 2). timeLimit defaults to 60 when LLM omits it. */
export const assessmentOutputSchema = z.object({
  title: z.string().max(100),
  description: z.string().min(50),
  timeLimit: z.coerce.number().int().min(30).max(480).default(60),
});

export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;

/** Step 1: requirements extraction + stack/level with confidence */
export const requirementsExtractionSchema = z.object({
  summary: z.string().describe("Short requirements summary from the job description"),
  keySkills: z.array(z.string()).optional().describe("Key skills or technologies mentioned"),
  suggestedScope: z.string().optional().describe("Suggested scope or focus for the assessment"),
  stack: assessmentStackSchema.describe("Inferred primary tech stack; use 'generic' when unclear"),
  level: roleLevelSchema.describe("Inferred role level; use 'mid' when unclear"),
  stackConfidence: routingConfidenceSchema.describe("Confidence in stack inference; 'high' only when JD explicitly names the stack"),
  levelConfidence: routingConfidenceSchema.describe("Confidence in level inference; 'high' only when JD explicitly states senior/junior"),
});

export type RequirementsExtraction = z.infer<typeof requirementsExtractionSchema>;

/** LLM quality review result: rules, quality, and feasibility check. */
export const assessmentReviewSchema = z.object({
  valid: z.boolean().describe("True only if the assessment passes rules, quality, and feasibility checks"),
  summaryFeedback: z.string().describe("When valid is false: concise summary of all issues for the user. When valid is true: empty string"),
  ruleIssues: z.array(z.string()).optional().describe("List of rule violations (word count, sections, checklist count, time limit, JD echo)"),
  qualityFeedback: z.string().optional().describe("Subjective quality concerns: specificity, clarity, fairness, definition of done"),
  feasibilityFeedback: z.string().optional().describe("Feasibility concerns: completable in time, no contradictions, no missing info, runnable with zero external setup"),
});

export type AssessmentReviewResult = z.infer<typeof assessmentReviewSchema>;
