import { z } from "zod";

const MAX_STEP_TIMEOUT_MS = 20 * 60 * 1000;

/** LLMs often emit 0 or omit; treat non-positive as absent so defaults apply. */
const runbookStepTimeoutMsSchema = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.min(Math.floor(n), MAX_STEP_TIMEOUT_MS);
  },
  z.number().int().positive().max(MAX_STEP_TIMEOUT_MS).optional()
);

export const runbookStepSchema = z.object({
  command: z.string().min(1),
  purpose: z.enum(["install", "test", "start", "setup"]),
  origin: z.enum(["readme", "inferred"]),
  cwd: z.string().optional(),
  timeoutMs: runbookStepTimeoutMsSchema,
});

export const runbookExecutionProfileSchema = z.enum([
  /** Single command or script prints output and exits; no HTTP server. */
  "cli_stdout",
  /** README implies dev/staging server with a port (npm start, uvicorn, etc.). */
  "web_server",
  /** Tests/build only, or README too thin to tell. */
  "unclear",
]);

export const runbookPlanSchema = z.object({
  steps: z.array(runbookStepSchema).min(1).max(12),
  portsHint: z.array(z.number().int().min(1).max(65535)).default([]),
  executionProfile: runbookExecutionProfileSchema.default("unclear"),
  readmeCoverage: z.object({
    hasInstallCommand: z.boolean(),
    hasTestCommand: z.boolean(),
    hasStartCommand: z.boolean(),
    notes: z.string().default(""),
  }),
});

export type RunbookStep = z.infer<typeof runbookStepSchema>;
export type RunbookPlan = z.infer<typeof runbookPlanSchema>;
