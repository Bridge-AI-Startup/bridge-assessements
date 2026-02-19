/**
 * Assessment generation service: two-step LangChain-style chain.
 * Step 1: Extract requirements + infer stack/level (with confidence).
 * Safe routing: use generic/mid unless confidence is high (or client overrides).
 * Step 2: Generate assessment from requirements + JD + stack + level.
 * Uses prompts from prompts/index.ts and createChatCompletion from langchainAI.
 */

import {
  PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS,
  PROMPT_GENERATE_ASSESSMENT_COMPONENTS,
  LEVEL_INSTRUCTIONS,
} from "../prompts/index.js";
import {
  createChatCompletion,
  type ChatMessage,
} from "./langchainAI.js";
import {
  requirementsExtractionSchema,
  assessmentOutputSchema,
  type RequirementsExtraction,
  type AssessmentOutput,
} from "./schemas/assessmentGeneration.js";
import type { AssessmentStack, RoleLevel, GenerateAssessmentOptions } from "../types/assessmentGeneration.js";

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

/** Step 1: Extract requirements and infer stack/level from job description. */
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

  const response = await createChatCompletion(
    "assessment_generation",
    messages,
    {
      temperature: 0.3,
      maxTokens: 800,
      responseFormat: { type: "json_object" },
      provider: PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.provider as "openai" | "anthropic" | "gemini",
      model: PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS.model,
    }
  );

  const content = response.content.trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : content;
  const parsed = JSON.parse(jsonStr);
  return requirementsExtractionSchema.parse(parsed);
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

/** Step 2: Generate assessment from requirements + JD + stack + level. */
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

  const response = await createChatCompletion(
    "assessment_generation",
    messages,
    {
      temperature: 0.5,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
      provider: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.provider as "openai" | "anthropic" | "gemini",
      model: PROMPT_GENERATE_ASSESSMENT_COMPONENTS.model,
    }
  );

  const content = response.content.trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : content;
  const parsed = JSON.parse(jsonStr);
  return assessmentOutputSchema.parse(parsed);
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

/**
 * Generate assessment components via two-step chain: extract requirements (with stack/level) → generate assessment.
 * Client can pass optional stack/level to override inferred values.
 */
export async function generateAssessmentComponents(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{ title: string; description: string; timeLimit: number }> {
  console.log("🤖 [assessmentGeneration] Two-step chain: extract requirements → generate assessment");

  const domain = selectRandomDomain();
  const seed = generateRandomSeed();
  console.log(`🎲 [assessmentGeneration] Domain: ${domain}, seed: ${seed}`);

  try {
    const step1 = await runStep1(jobDescription, domain, seed);
    console.log("✅ [assessmentGeneration] Step 1:", {
      stack: step1.stack,
      level: step1.level,
      stackConfidence: step1.stackConfidence,
      levelConfidence: step1.levelConfidence,
    });

    const { stack, level } = applySafeRouting(step1, options);
    console.log(`🔀 [assessmentGeneration] Routing: stack=${stack}, level=${level}`);

    const step2 = await runStep2(step1, jobDescription, stack, level, domain, seed);
    return normalizeOutput(step2, jobDescription);
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
 */
export async function generateAssessmentComponentsWithSteps(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  step1: RequirementsExtraction;
  assessment: { title: string; description: string; timeLimit: number };
}> {
  const domain = selectRandomDomain();
  const seed = generateRandomSeed();
  console.log("🤖 [assessmentGeneration] Two-step chain (with steps output): extract requirements → generate assessment");
  console.log(`🎲 [assessmentGeneration] Domain: ${domain}, seed: ${seed}`);

  try {
    const step1 = await runStep1(jobDescription, domain, seed);
    console.log("✅ [assessmentGeneration] Step 1:", {
      stack: step1.stack,
      level: step1.level,
      stackConfidence: step1.stackConfidence,
      levelConfidence: step1.levelConfidence,
    });

    const { stack, level } = applySafeRouting(step1, options);
    console.log(`🔀 [assessmentGeneration] Routing: stack=${stack}, level=${level}`);

    const step2 = await runStep2(step1, jobDescription, stack, level, domain, seed);
    const assessment = normalizeOutput(step2, jobDescription);
    return { step1, assessment };
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
