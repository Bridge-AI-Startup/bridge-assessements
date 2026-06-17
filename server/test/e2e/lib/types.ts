/**
 * Shared result types for the demo-readiness E2E suite.
 * These are serialized to test/results/results.json and consumed by the
 * DemoReadiness.canvas.tsx navigable sheet.
 */

export type StepStatus = "pass" | "fail" | "blocked" | "skipped";

export interface Evidence {
  /** "json" inlines a value; "screenshot"/"file" reference a path on disk. */
  type: "json" | "text" | "screenshot" | "file";
  label: string;
  /** Inline value for json/text evidence. */
  value?: unknown;
  /** Path (absolute or repo-relative) for screenshot/file evidence. */
  path?: string;
}

export interface StepResult {
  name: string;
  status: StepStatus;
  durationMs: number;
  detail?: string;
  evidence: Evidence[];
}

export interface Recommendation {
  id: string;
  severity: "blocker" | "major" | "minor";
  process: string; // e.g. "P1"
  issue: string;
  rootCause: string;
  recommendedFix: string;
  files: string[];
  effort: "small" | "medium" | "large";
}

export interface ProcessResult {
  id: string; // "P1".."P7"
  title: string;
  description: string;
  status: StepStatus;
  startedAt: string;
  durationMs: number;
  summary: string;
  steps: StepResult[];
  scriptPath: string;
  recommendation?: Recommendation;
}

export interface SuiteResults {
  generatedAt: string;
  durationMs: number;
  apiBaseUrl: string;
  env: Record<string, string | number | boolean | null>;
  processes: ProcessResult[];
  fixes: Recommendation[];
  screenshots: Array<{ process: string; label: string; path: string }>;
  unitTests: {
    ran: boolean;
    total: number;
    passed: number;
    failed: number;
    file: string;
  };
}
