/**
 * Parses raw user input (job description) into a structured AssessmentInputSpec
 * so assessment generation can use skill level, tech stack, and other aspects
 * to build better prompts.
 */

import {
  PROMPT_PARSE_ASSESSMENT_INPUT,
} from "../prompts/index.js";
import { createChatCompletion } from "./langchainAI.js";
import type {
  AssessmentInputSpec,
  SkillLevel,
  RoleFocus,
} from "../types/assessmentInputSpec.js";
import { DEFAULT_ASSESSMENT_INPUT_SPEC } from "../types/assessmentInputSpec.js";

const SKILL_LEVELS: SkillLevel[] = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
];
const ROLE_FOCUSES: RoleFocus[] = [
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "devops",
  "data",
  "embedded",
  "other",
];

function normalizeSkillLevel(value: unknown): SkillLevel {
  if (value == null || value === "") return null;
  const s = String(value).toLowerCase().trim();
  const found = SKILL_LEVELS.find((l) => l === s);
  return found ?? null;
}

function normalizeRoleFocus(value: unknown): RoleFocus {
  if (value == null || value === "") return null;
  const s = String(value).toLowerCase().trim();
  const found = ROLE_FOCUSES.find((l) => l === s);
  return found ?? null;
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  if (value == null || value === "") return "low";
  const s = String(value).toLowerCase().trim();
  if (s === "medium" || s === "high") return s;
  return "low";
}

/**
 * Parse a job description (or role blurb) into a structured spec using the LLM.
 * On failure or empty input, returns the default spec with confidence "low".
 */
export async function parseAssessmentInput(
  jobDescription: string
): Promise<AssessmentInputSpec> {
  const trimmed = jobDescription?.trim();
  if (!trimmed || trimmed.length < 10) {
    return { ...DEFAULT_ASSESSMENT_INPUT_SPEC, confidence: "low" };
  }

  try {
    const messages = [
      { role: "system" as const, content: PROMPT_PARSE_ASSESSMENT_INPUT.system },
      {
        role: "user" as const,
        content: PROMPT_PARSE_ASSESSMENT_INPUT.userTemplate(trimmed),
      },
    ];

    const response = await createChatCompletion(
      "assessment_input_parsing",
      messages,
      {
        temperature: 0.2,
        maxTokens: 800,
        responseFormat: { type: "json_object" },
        provider: PROMPT_PARSE_ASSESSMENT_INPUT.provider,
        model: PROMPT_PARSE_ASSESSMENT_INPUT.model,
      }
    );

    const content = response.content?.trim();
    if (!content) return { ...DEFAULT_ASSESSMENT_INPUT_SPEC, confidence: "low" };

    const raw = JSON.parse(content) as Record<string, unknown>;

    const techStack = Array.isArray(raw.techStack)
      ? (raw.techStack as unknown[])
          .filter((t) => typeof t === "string" && t.trim().length > 0)
          .map((t) => String(t).trim())
      : [];

    const scopeHints = Array.isArray(raw.scopeHints)
      ? (raw.scopeHints as unknown[])
          .filter((s) => typeof s === "string" && (s as string).trim().length > 0)
          .map((s) => String(s).trim())
      : [];

    const spec: AssessmentInputSpec = {
      skillLevel: normalizeSkillLevel(raw.skillLevel),
      roleFocus: normalizeRoleFocus(raw.roleFocus),
      techStack,
      experienceYears:
        typeof raw.experienceYears === "string" && raw.experienceYears.trim()
          ? raw.experienceYears.trim()
          : null,
      roleSummary:
        typeof raw.roleSummary === "string" && raw.roleSummary.trim()
          ? raw.roleSummary.trim()
          : null,
      scopeHints,
      confidence: normalizeConfidence(raw.confidence),
    };

    console.log("📋 [assessmentInputAnalyzer] Parsed spec:", {
      skillLevel: spec.skillLevel,
      roleFocus: spec.roleFocus,
      techStackCount: spec.techStack.length,
      confidence: spec.confidence,
    });

    return spec;
  } catch (err) {
    console.warn("⚠️ [assessmentInputAnalyzer] Parse failed, using default spec:", err);
    return { ...DEFAULT_ASSESSMENT_INPUT_SPEC, confidence: "low" };
  }
}
