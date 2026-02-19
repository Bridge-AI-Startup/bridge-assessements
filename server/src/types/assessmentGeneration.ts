/**
 * Types for assessment generation (stack, level, routing).
 * Used by the assessment generation service and optional API overrides.
 */

export type AssessmentStack =
  | "frontend-react"
  | "frontend-vue"
  | "backend-node"
  | "backend-python"
  | "mobile-react-native"
  | "fullstack"
  | "generic";

export type RoleLevel = "junior" | "mid" | "senior";

export type RoutingConfidence = "high" | "medium" | "low";

export type GenerateAssessmentOptions = {
  stack?: AssessmentStack;
  level?: RoleLevel;
};
