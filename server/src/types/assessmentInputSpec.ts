/**
 * Structured breakdown of user input (job description / role description)
 * used to build better assessment prompts. Produced by the assessment input analyzer.
 */
export type SkillLevel =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | null;

export type RoleFocus =
  | "backend"
  | "frontend"
  | "fullstack"
  | "mobile"
  | "devops"
  | "data"
  | "embedded"
  | "other"
  | null;

export interface AssessmentInputSpec {
  /** Inferred seniority (e.g. junior, senior). null if unclear. */
  skillLevel: SkillLevel;
  /** Primary role focus (backend, frontend, fullstack, etc.). null if unclear. */
  roleFocus: RoleFocus;
  /** Technologies explicitly or strongly implied (e.g. Node.js, React, PostgreSQL). */
  techStack: string[];
  /** Years of experience if mentioned (e.g. "3+", "5-7"). null if not stated. */
  experienceYears: string | null;
  /** Short summary of the role in one sentence, for prompt context. */
  roleSummary: string | null;
  /** Any explicit scope or constraint mentioned (e.g. "take-home under 2 hours"). */
  scopeHints: string[];
  /** Raw confidence: low = many nulls, high = most fields filled from clear signals. */
  confidence: "low" | "medium" | "high";
}

export const DEFAULT_ASSESSMENT_INPUT_SPEC: AssessmentInputSpec = {
  skillLevel: null,
  roleFocus: null,
  techStack: [],
  experienceYears: null,
  roleSummary: null,
  scopeHints: [],
  confidence: "low",
};
