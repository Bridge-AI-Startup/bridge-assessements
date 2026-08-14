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

/**
 * One suggested request in a machine-checkable acceptance criterion.
 *
 * Deliberately flatter and looser than the real `BehavioralCheckSpec` schema in
 * `behavioralGrading/checkSpecs.ts`: an LLM producing a deep discriminated union
 * fails in ways that are tedious to recover from, so it emits this shape and the
 * server converts + strictly validates. A suggestion that will not convert is
 * dropped, leaving the check to the agent judge.
 */
const suggestedRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1).max(300).describe("Path only, starting with /"),
  jsonBody: z
    .string()
    .max(4000)
    .optional()
    .describe("Request body as a JSON string, when the request sends one"),
  expectStatus: z
    .array(z.coerce.number().int().min(100).max(599))
    .max(5)
    .optional()
    .describe("Acceptable response status codes"),
  expectBodyContains: z
    .array(z.string().min(1).max(500))
    .max(5)
    .optional()
    .describe("Substrings the response body must contain"),
});

/**
 * One UI walkthrough step. Flatter than `uiStepSchema` so the generator does
 * not have to emit a discriminated union.
 */
export const suggestedUiStepSchema = z.object({
  action: z.enum([
    "goto",
    "fill_placeholder",
    "fill_role",
    "click_role",
    "click_text",
    "expect_text",
  ]),
  path: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  role: z
    .enum(["textbox", "searchbox", "combobox", "button", "link", "checkbox"])
    .optional(),
  name: z.string().max(200).optional(),
  exact: z.boolean().optional(),
  text: z.string().max(500).optional(),
  value: z.string().max(2000).optional(),
  absent: z.boolean().optional(),
});

export const suggestedAcceptanceSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(400)
    .describe("Must exactly match one entry in checks"),
  kind: z
    .enum(["http", "http_sequence", "restart_persistence", "ui", "agent"])
    .describe(
      "ui = drive the page; http* only when the description already names the path"
    ),
  requests: z.array(suggestedRequestSchema).max(4).optional(),
  uiSteps: z.array(suggestedUiStepSchema).max(12).optional(),
});

/** Plain-language behavioral checks (stack-agnostic, observable). */
export const behavioralChecksOutputSchema = z.object({
  checks: z
    .array(z.string().min(1).max(400))
    .min(5)
    .max(18)
    .describe("Observable behaviors any reasonable implementation should satisfy"),
  acceptance: z
    .array(suggestedAcceptanceSchema)
    .max(18)
    .optional()
    .describe(
      "One entry per check that can be settled by a UI walkthrough or a pinned HTTP contract"
    ),
});

export type BehavioralChecksOutput = z.infer<typeof behavioralChecksOutputSchema>;
export type SuggestedAcceptance = NonNullable<
  BehavioralChecksOutput["acceptance"]
>[number];
export type SuggestedUiStep = z.infer<typeof suggestedUiStepSchema>;

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

/** Starter code generation output: a list of files. */
export const starterCodeGenerationSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().describe("Relative file path, e.g. src/App.jsx"),
      content: z.string().describe("Full file content as a string"),
    })
  ),
});

export type StarterCodeGenerationOutput = z.infer<typeof starterCodeGenerationSchema>;
