/**
 * Bridge from the candidate's finalized runtime setup to a grading runbook.
 *
 * When a candidate has finalized and verified a runtime config, the commands are
 * already known to work on this exact snapshot. Re-deriving them from the README
 * with an LLM costs a model call and can produce different commands than the
 * ones the candidate proved, so grading prefers the config when it exists.
 */
import { runbookPlanSchema, type RunbookPlan } from "./schema.js";
import {
  runtimeConfigSchema,
  type RuntimeConfig,
  type RuntimeEnvVar,
} from "../runtimeSetup/schema.js";

export type CandidateRunbook = {
  runbook: RunbookPlan;
  config: RuntimeConfig;
};

/**
 * Steps are marked `origin: "readme"` because the candidate authored and
 * verified them; nothing here is a guess, which is what `inferred` means to the
 * README-coverage requirement.
 */
export function runtimeConfigToRunbook(config: RuntimeConfig): RunbookPlan {
  const rootDir = (config.rootDir || ".").trim();
  const cwd = rootDir && rootDir !== "." ? rootDir : undefined;

  const steps: Array<{
    command: string;
    purpose: "install" | "setup" | "start";
    origin: "readme";
    cwd?: string;
  }> = [];

  const install = config.installCommand?.trim();
  if (install) {
    steps.push({ command: install, purpose: "install", origin: "readme", cwd });
  }
  const build = config.buildCommand?.trim();
  if (build) {
    steps.push({ command: build, purpose: "setup", origin: "readme", cwd });
  }
  const start = config.startCommand?.trim();
  if (start) {
    steps.push({ command: start, purpose: "start", origin: "readme", cwd });
  }

  return runbookPlanSchema.parse({
    steps,
    portsHint: config.port ? [config.port] : [],
    executionProfile: config.executionProfile,
    readmeCoverage: {
      hasInstallCommand: Boolean(install),
      hasTestCommand: false,
      hasStartCommand: Boolean(start),
      notes:
        "Commands come from the candidate's finalized runtime setup, verified in a sandbox before submission.",
    },
  });
}

/**
 * Environment the candidate's verified run had. `PORT` is added when the config
 * pins a port and the candidate did not set it themselves — the setup runner
 * does the same, so omitting it here would start the app differently.
 */
export function candidateGradingEnv(config: RuntimeConfig): RuntimeEnvVar[] {
  const envVars = (config.envVars || []).filter((row) => row.key);
  if (!config.port || envVars.some((row) => row.key === "PORT")) {
    return envVars;
  }
  return [
    ...envVars,
    { key: "PORT", value: String(config.port), secret: false },
  ];
}

/**
 * Returns the candidate-authored runbook, or null when grading should plan from
 * the README instead (setup never finalized, the last run failed verification,
 * or the stored config no longer parses).
 */
export function candidateRunbookFromSubmission(submission: {
  runtimeSetup?: { status?: string | null; verified?: boolean | null } | null;
  runtimeConfig?: unknown;
}): CandidateRunbook | null {
  const setup = submission?.runtimeSetup;
  if (setup?.status !== "finalized" || !setup?.verified) return null;

  const parsed = runtimeConfigSchema.safeParse(submission.runtimeConfig || {});
  if (!parsed.success) return null;
  if (!parsed.data.startCommand.trim()) return null;

  return { config: parsed.data, runbook: runtimeConfigToRunbook(parsed.data) };
}
