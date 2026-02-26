/**
 * Assessment generation service: two-step LCEL-style chain with structured output, retries, and quality review.
 * Step 1: Extract requirements + infer stack/level (with confidence).
 * Safe routing: use generic/mid unless confidence is high (or client overrides).
 * Step 2: Generate assessment from requirements + JD + stack + level.
 * Step 3 (optional): Rule-based quality review; sets reviewFeedback and optionally regenerates once.
 * Uses prompts from prompts/index.ts and createChatCompletionWithStructuredOutput from langchainAI.
 */

import {
  PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS,
  PROMPT_GENERATE_ASSESSMENT_COMPONENTS,
  PROMPT_ASSESSMENT_QUALITY_REVIEW,
  LEVEL_INSTRUCTIONS,
} from "../prompts/index.js";
import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "./langchainAI.js";
import {
  requirementsExtractionSchema,
  assessmentOutputSchema,
  assessmentReviewSchema,
  type RequirementsExtraction,
  type AssessmentOutput,
} from "./schemas/assessmentGeneration.js";
import type { AssessmentStack, RoleLevel, GenerateAssessmentOptions } from "../types/assessmentGeneration.js";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

const MAX_PARSE_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const ASSESSMENT_DOMAINS = [
  "Music streaming website",
  "Social media platform",
  "E-commerce marketplace",
  "Fitness or health tracking app",
  "Online learning platform",
  "Travel booking or itinerary planner",
  "Food delivery or restaurant app",
  "Personal finance or budgeting tool",
  "Project or task management app",
  "Customer support or help-desk system",
  "News or content publishing site",
  "Real-time chat or messaging app",
  "Job board or recruiting platform",
  "Event management or ticketing system",
  "Inventory or asset tracking system",
  "Analytics or reporting dashboard",
  "Recommendation or discovery platform",
  "Productivity or note-taking app",
  "Media library or file management system",
  "Device or system monitoring dashboard",
];

function generateRandomSeed(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const length = Math.floor(Math.random() * 5) + 8;
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function selectRandomDomain(): string {
  return ASSESSMENT_DOMAINS[Math.floor(Math.random() * ASSESSMENT_DOMAINS.length)];
}

/** Return example assessments for few-shot; empty until you provide examples. */
export function getExamplesForStack(
  _stack: AssessmentStack,
  _level?: RoleLevel
): Array<{ title: string; description: string; timeLimit: number }> {
  return [];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Step 1: Extract requirements and infer stack/level from job description. Uses structured output + retries. */
async function runStep1(
  jobDescription: string,
  domain?: string,
  seed?: string
): Promise<RequirementsExtraction> {
  const userContent = PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.userTemplate(jobDescription);
  const messages: ChatMessage[] = [
    { role: "system", content: PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.system },
    { role: "user", content: userContent },
  ];

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    try {
      const { result } = await createChatCompletionWithStructuredOutput(
        "assessment_generation",
        messages,
        requirementsExtractionSchema,
        {
          temperature: 0.3,
          maxTokens: 800,
          provider: PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.provider as "openai" | "anthropic" | "gemini",
          model: PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.model,
        }
      );
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_PARSE_RETRIES) {
        console.warn(`⚠️ [assessmentGeneration] Step 1 parse attempt ${attempt} failed, retrying...`, err);
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Apply safe routing: only use specific stack/level when confidence is high.
 * Client overrides (stack/level from request) take precedence.
 */
function applySafeRouting(
  step1: RequirementsExtraction,
  clientOverride?: GenerateAssessmentOptions
): { stack: AssessmentStack; level: RoleLevel } {
  if (clientOverride?.stack !== undefined && clientOverride?.level !== undefined) {
    return { stack: clientOverride.stack, level: clientOverride.level };
  }
  const stack: AssessmentStack =
    clientOverride?.stack ??
    (step1.stackConfidence === "high" ? step1.stack : "generic");
  const level: RoleLevel =
    clientOverride?.level ??
    (step1.levelConfidence === "high" ? step1.level : "mid");

  if (step1.stackConfidence !== "high" && !clientOverride?.stack) {
    console.log(`🔀 [assessmentGeneration] Stack confidence "${step1.stackConfidence}" → using generic`);
  }
  if (step1.levelConfidence !== "high" && !clientOverride?.level) {
    console.log(`🔀 [assessmentGeneration] Level confidence "${step1.levelConfidence}" → using mid`);
  }
  return { stack, level };
}

/** Step 2: Generate assessment from requirements + JD + stack + level. Uses structured output + retries. */
async function runStep2(
  step1: RequirementsExtraction,
  jobDescription: string,
  stack: AssessmentStack,
  level: RoleLevel,
  domain: string,
  seed: string
): Promise<AssessmentOutput> {
  const levelBlock = LEVEL_INSTRUCTIONS[level];
  const examples = getExamplesForStack(stack, level);
  const fewShotBlock =
    examples.length > 0
      ? `\n\nExample assessments (use as style reference):\n${examples
          .map(
            (e) =>
              `Title: ${e.title}\nDescription: ${e.description.slice(0, 200)}...\nTimeLimit: ${e.timeLimit}`
          )
          .join("\n---\n")}`
      : "";

  const systemContent = `${PROMPT_GENERATE_ASSESSMENT_COMPONENTS.system}\n\n${levelBlock}${fewShotBlock}`;
  const userContent = `${PROMPT_GENERATE_ASSESSMENT_COMPONENTS.userTemplate(
    jobDescription,
    domain,
    seed
  )}\n\nExtracted requirements summary (use this to focus the assessment):\n${step1.summary}\n\nInferred stack: ${stack}. Inferred level: ${level}.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    try {
      const { result } = await createChatCompletionWithStructuredOutput(
        "assessment_generation",
        messages,
        assessmentOutputSchema,
        {
          temperature: 0.5,
          maxTokens: 3000,
          provider: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.provider as "openai" | "anthropic" | "gemini",
          model: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.model,
        }
      );
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_PARSE_RETRIES) {
        console.warn(`⚠️ [assessmentGeneration] Step 2 parse attempt ${attempt} failed, retrying...`, err);
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

/** Step 2 with optional quality feedback: same as runStep2 but adds feedback to system message for one retry. */
async function runStep2WithFeedback(
  step1: RequirementsExtraction,
  jobDescription: string,
  stack: AssessmentStack,
  level: RoleLevel,
  domain: string,
  seed: string,
  feedback: string
): Promise<AssessmentOutput> {
  const levelBlock = LEVEL_INSTRUCTIONS[level];
  const examples = getExamplesForStack(stack, level);
  const fewShotBlock =
    examples.length > 0
      ? `\n\nExample assessments (use as style reference):\n${examples
          .map(
            (e) =>
              `Title: ${e.title}\nDescription: ${e.description.slice(0, 200)}...\nTimeLimit: ${e.timeLimit}`
          )
          .join("\n---\n")}`
      : "";

  const feedbackBlock = `\n\nIMPORTANT - Quality feedback from a previous attempt (you must address these):\n${feedback}`;
  const systemContent = `${PROMPT_GENERATE_ASSESSMENT_COMPONENTS.system}\n\n${levelBlock}${fewShotBlock}${feedbackBlock}`;
  const userContent = `${PROMPT_GENERATE_ASSESSMENT_COMPONENTS.userTemplate(
    jobDescription,
    domain,
    seed
  )}\n\nExtracted requirements summary (use this to focus the assessment):\n${step1.summary}\n\nInferred stack: ${stack}. Inferred level: ${level}.`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];

  const { result } = await createChatCompletionWithStructuredOutput(
    "assessment_generation",
    messages,
    assessmentOutputSchema,
    {
      temperature: 0.4,
      maxTokens: 3000,
      provider: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.provider as "openai" | "anthropic" | "gemini",
      model: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.model,
    }
  );
  return result;
}

/** Normalize Step 2 output: title truncation, timeLimit clamp, description fallback. */
function normalizeOutput(
  raw: AssessmentOutput,
  jobDescription: string
): { title: string; description: string; timeLimit: number } {
  const title = raw.title?.trim() || "New Assessment";
  const finalTitle = title.length > 100 ? title.substring(0, 97) + "..." : title;

  const jdTrim = jobDescription.trim();
  let description = raw.description?.trim() || "";

  // If model echoed the job description instead of project instructions, treat as missing
  const sameAsJd =
    description.length >= 40 &&
    jdTrim.length >= 40 &&
    (description === jdTrim ||
      description.includes(jdTrim.slice(0, 80)) ||
      jdTrim.includes(description.slice(0, 80)));
  if (sameAsJd) {
    description = "";
  }

  if (!description || description.length < 50) {
    description = `Build a practical coding project based on: ${jdTrim.substring(
      0,
      200
    )}. This assessment will evaluate your ability to implement real-world features and solve practical problems.`;
  }

  let timeLimit = raw.timeLimit;
  if (timeLimit === undefined || timeLimit === null) timeLimit = 60;
  if (typeof timeLimit === "string") timeLimit = parseInt(String(timeLimit), 10) || 60;
  if (!Number.isFinite(timeLimit) || timeLimit < 30) timeLimit = 60;
  if (timeLimit > 480) timeLimit = 240;

  return { title: finalTitle, description, timeLimit };
}

/** Required section topics (flexible match on header text). */
const REQUIRED_SECTION_TOPICS = [
  "scenario",
  "what you will build",
  "requirements",
  "acceptance criteria",
  "constraints",
  "provided",
  "assumptions",
  "deliverables",
  "nice-to-have",
];

/**
 * Rule-based quality review. Returns passed and optional reviewFeedback.
 * Checks: word count 300-650, required sections present, ≥10 acceptance checklist items, timeLimit in range.
 */
function runQualityReview(
  normalized: { title: string; description: string; timeLimit: number },
  jobDescription: string
): { passed: boolean; reviewFeedback?: string } {
  const desc = normalized.description;
  const issues: string[] = [];

  const wordCount = desc.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) issues.push(`Description is ${wordCount} words (minimum 300).`);
  if (wordCount > 650) issues.push(`Description is ${wordCount} words (maximum 650).`);

  const sectionHeaders = desc.match(/^##\s+(.+)$/gm) || [];
  const sectionText = sectionHeaders.map((s) => s.replace(/^##\s+/i, "").trim().toLowerCase()).join(" ");
  const missing = REQUIRED_SECTION_TOPICS.filter((topic) => !sectionText.includes(topic));
  if (missing.length > 0) {
    issues.push(`Missing or unclear section topics: ${missing.join(", ")}.`);
  }

  const checklistItems = desc.match(/^\s*-\s*\[\s*\]/gm) || [];
  if (checklistItems.length < 10) {
    issues.push(`Acceptance criteria has ${checklistItems.length} checklist items (need at least 10).`);
  }

  if (normalized.timeLimit < 30 || normalized.timeLimit > 480) {
    issues.push(`Time limit ${normalized.timeLimit} is outside allowed range [30–480].`);
  }

  const jdTrim = jobDescription.trim();
  if (
    desc.length >= 40 &&
    jdTrim.length >= 40 &&
    (desc === jdTrim ||
      desc.includes(jdTrim.slice(0, 80)) ||
      jdTrim.includes(desc.slice(0, 80)))
  ) {
    issues.push("Description appears to echo the job description instead of project instructions.");
  }

  if (issues.length === 0) {
    return { passed: true };
  }
  return {
    passed: false,
    reviewFeedback: `Quality check: ${issues.join(" ")}`,
  };
}

/**
 * LLM-based quality review: checks rules, quality (specificity, clarity, fairness), and feasibility (completable in time, runnable without external setup).
 * Returns valid and summaryFeedback for the user; optional ruleIssues, qualityFeedback, feasibilityFeedback.
 */
async function runQualityReviewLLM(
  normalized: { title: string; description: string; timeLimit: number },
  jobDescription: string
): Promise<{ passed: boolean; reviewFeedback?: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: PROMPT_ASSESSMENT_QUALITY_REVIEW.system },
    {
      role: "user",
      content: PROMPT_ASSESSMENT_QUALITY_REVIEW.userTemplate(
        normalized.title,
        normalized.description,
        normalized.timeLimit,
        jobDescription
      ),
    },
  ];

  const { result } = await createChatCompletionWithStructuredOutput(
    "assessment_generation",
    messages,
    assessmentReviewSchema,
    {
      temperature: 0.2,
      maxTokens: 800,
      provider: PROMPT_ASSESSMENT_QUALITY_REVIEW.provider as "openai" | "anthropic" | "gemini",
      model: PROMPT_ASSESSMENT_QUALITY_REVIEW.model,
    }
  );

  if (result.valid) {
    return { passed: true };
  }
  const parts: string[] = [result.summaryFeedback];
  if (result.qualityFeedback?.trim()) parts.push(`Quality: ${result.qualityFeedback.trim()}`);
  if (result.feasibilityFeedback?.trim()) parts.push(`Feasibility: ${result.feasibilityFeedback.trim()}`);
  return {
    passed: false,
    reviewFeedback: parts.join(" "),
  };
}
interface AssessmentChainState {
  jobDescription: string;
  domain: string;
  seed: string;
  options?: GenerateAssessmentOptions;
  step1?: RequirementsExtraction;
  stack?: AssessmentStack;
  level?: RoleLevel;
  raw?: AssessmentOutput;
  assessment?: { title: string; description: string; timeLimit: number };
}

/** Build and return the LCEL chain: step1 → routing → step2 → normalize. */
function buildAssessmentChain() {
  const step1Runnable = RunnableLambda.from(async (state: AssessmentChainState) => {
    const step1 = await runStep1(state.jobDescription, state.domain, state.seed);
    return { ...state, step1 };
  }).withRetry({ stopAfterAttempt: 2 });

  const routingRunnable = RunnableLambda.from((state: AssessmentChainState) => {
    const { stack, level } = applySafeRouting(state.step1!, state.options);
    return { ...state, stack, level };
  });

  const step2Runnable = RunnableLambda.from(async (state: AssessmentChainState) => {
    const raw = await runStep2(
      state.step1!,
      state.jobDescription,
      state.stack!,
      state.level!,
      state.domain,
      state.seed
    );
    return { ...state, raw };
  }).withRetry({ stopAfterAttempt: 2 });

  const normalizeRunnable = RunnableLambda.from((state: AssessmentChainState) => {
    const assessment = normalizeOutput(state.raw!, state.jobDescription);
    return { ...state, assessment };
  });

  return RunnableSequence.from([step1Runnable, routingRunnable, step2Runnable, normalizeRunnable]);
}

/**
 * Run the full assessment chain (step1 → routing → step2 → normalize), then run quality review and optionally retry once.
 * Returns { step1, assessment } where assessment may include reviewFeedback.
 */
async function runAssessmentChain(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  step1: RequirementsExtraction;
  assessment: { title: string; description: string; timeLimit: number; reviewFeedback?: string };
}> {
  const domain = selectRandomDomain();
  const seed = generateRandomSeed();
  console.log(`🎲 [assessmentGeneration] Domain: ${domain}, seed: ${seed}`);
  const chain = buildAssessmentChain();
  const state = await chain.invoke({
    jobDescription,
    domain,
    seed,
    options,
  } as AssessmentChainState);

  const step1 = state.step1!;
  console.log("✅ [assessmentGeneration] Step 1:", {
    stack: step1.stack,
    level: step1.level,
    stackConfidence: step1.stackConfidence,
    levelConfidence: step1.levelConfidence,
  });
  console.log(`🔀 [assessmentGeneration] Routing: stack=${state.stack}, level=${state.level}`);
  let assessment = state.assessment!;

  // 1) Rule-based review first (fast)
  const ruleReview = runQualityReview(assessment, jobDescription);
  if (!ruleReview.passed && ruleReview.reviewFeedback) {
    console.log("⚠️ [assessmentGeneration] Rule-based review failed, retrying Step 2 once with feedback...");
    try {
      const step2Retry = await runStep2WithFeedback(
        step1,
        jobDescription,
        state.stack!,
        state.level!,
        domain,
        seed,
        ruleReview.reviewFeedback
      );
      const retryAssessment = normalizeOutput(step2Retry, jobDescription);
      const retryRule = runQualityReview(retryAssessment, jobDescription);
      if (!retryRule.passed) {
        return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback } };
      }
      const retryLLM = await runQualityReviewLLM(retryAssessment, jobDescription);
      if (retryLLM.passed) return { step1, assessment: retryAssessment };
      return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback } };
    } catch {
      return { step1, assessment: { ...assessment, reviewFeedback: ruleReview.reviewFeedback } };
    }
  }

  // 2) LLM review: quality + feasibility
  const llmReview = await runQualityReviewLLM(assessment, jobDescription);
  if (!llmReview.passed && llmReview.reviewFeedback) {
    console.log("⚠️ [assessmentGeneration] LLM quality/feasibility review failed, retrying Step 2 once with feedback...");
    try {
      const step2Retry = await runStep2WithFeedback(
        step1,
        jobDescription,
        state.stack!,
        state.level!,
        domain,
        seed,
        llmReview.reviewFeedback
      );
      const retryAssessment = normalizeOutput(step2Retry, jobDescription);
      const retryRule = runQualityReview(retryAssessment, jobDescription);
      if (!retryRule.passed) {
        return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback } };
      }
      const retryLLM = await runQualityReviewLLM(retryAssessment, jobDescription);
      if (retryLLM.passed) return { step1, assessment: retryAssessment };
      return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback } };
    } catch {
      return { step1, assessment: { ...assessment, reviewFeedback: llmReview.reviewFeedback } };
    }
  }

  return { step1, assessment };
}

/**
 * Generate assessment components via two-step chain: extract requirements (with stack/level) → generate assessment → quality review (rule-based + LLM).
 * Client can pass optional stack/level to override inferred values.
 * Returns reviewFeedback when the rule-based or LLM quality/feasibility check fails (optional; clients can display it).
 */
export async function generateAssessmentComponents(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{ title: string; description: string; timeLimit: number; reviewFeedback?: string }> {
  console.log("🤖 [assessmentGeneration] LCEL chain: extract requirements → generate assessment → review");
  try {
    const { assessment } = await runAssessmentChain(jobDescription, options);
    return assessment;
  } catch (error) {
    console.error("❌ [assessmentGeneration] Error:", error);
    console.log("🔄 [assessmentGeneration] Falling back to simple defaults...");
    const firstSentence = jobDescription.split(/[.!?]/)[0].trim();
    const title =
      firstSentence.length > 0 && firstSentence.length <= 100
        ? firstSentence
        : jobDescription.substring(0, 50).trim() + "...";
    const description = `Assessment generation could not be completed. Please try again or create the assessment manually. (Error: ${error instanceof Error ? error.message : "unknown"})`;
    return { title, description, timeLimit: 60 };
  }
}

/**
 * Same as generateAssessmentComponents but returns Step 1 (requirements extraction) and final assessment.
 * Useful for notebooks and debugging to inspect stack/level inference and routing.
 * Assessment may include reviewFeedback when quality review fails.
 */
export async function generateAssessmentComponentsWithSteps(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  step1: RequirementsExtraction;
  assessment: { title: string; description: string; timeLimit: number; reviewFeedback?: string };
}> {
  console.log("🤖 [assessmentGeneration] LCEL chain (with steps output): extract requirements → generate assessment → review");
  try {
    return await runAssessmentChain(jobDescription, options);
  } catch (error) {
    console.error("❌ [assessmentGeneration] Error:", error);
    const firstSentence = jobDescription.split(/[.!?]/)[0].trim();
    const title =
      firstSentence.length > 0 && firstSentence.length <= 100
        ? firstSentence
        : jobDescription.substring(0, 50).trim() + "...";
    const description = `Assessment generation failed. Please check your API key and try again. (${error instanceof Error ? error.message : "unknown"})`;
    const assessment = { title, description, timeLimit: 60 };
    const step1: RequirementsExtraction = {
      summary: jobDescription.slice(0, 300),
      stack: "generic",
      level: "mid",
      stackConfidence: "low",
      levelConfidence: "low",
    };
    return { step1, assessment };
  }
}
