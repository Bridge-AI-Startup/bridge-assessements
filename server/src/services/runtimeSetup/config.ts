/**
 * Feature-flag and resource/time caps for post-submission runtime setup.
 * Off unless RUNTIME_SETUP_ENABLED=true.
 */

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

export function isRuntimeSetupEnabled(): boolean {
  return envBool("RUNTIME_SETUP_ENABLED", false);
}

export function getRuntimeSetupMaxConcurrent(): number {
  return envInt("RUNTIME_SETUP_MAX_CONCURRENT", 3, 1, 20);
}

export function getRuntimeSetupSandboxTtlMs(): number {
  return envInt("RUNTIME_SETUP_SANDBOX_TTL_MS", 30 * 60 * 1000, 60_000, 60 * 60 * 1000);
}

export function getRuntimeSetupIdlePauseMs(): number {
  return envInt("RUNTIME_SETUP_IDLE_PAUSE_MS", 4 * 60 * 1000, 30_000, 30 * 60 * 1000);
}

export function getRuntimeSetupInstallTimeoutMs(): number {
  return envInt("RUNTIME_SETUP_INSTALL_TIMEOUT_MS", 10 * 60 * 1000, 10_000, 20 * 60 * 1000);
}

export function getRuntimeSetupBuildTimeoutMs(): number {
  return envInt("RUNTIME_SETUP_BUILD_TIMEOUT_MS", 10 * 60 * 1000, 10_000, 20 * 60 * 1000);
}

export function getRuntimeSetupRunMaxMs(): number {
  return envInt("RUNTIME_SETUP_RUN_MAX_MS", 15 * 60 * 1000, 30_000, 30 * 60 * 1000);
}

export function denyEgressAtRuntime(): boolean {
  return envBool("RUNTIME_SETUP_DENY_EGRESS_AT_RUNTIME", true);
}

export function getRuntimeSetupRunsPerHour(): number {
  return envInt("RUNTIME_SETUP_RUNS_PER_HOUR", 12, 1, 60);
}

export function getRuntimeSetupHealthWaitMs(): number {
  return envInt("RUNTIME_SETUP_HEALTH_WAIT_MS", 90_000, 5_000, 180_000);
}

/** Run phases that must not be idle-paused (install can exceed the 4m idle window). */
export const RUNTIME_SETUP_BUSY_RUN_PHASES = [
  "installing",
  "building",
  "starting",
  "waiting_health",
] as const;

export function isBusyRunPhase(phase?: string | null): boolean {
  return (RUNTIME_SETUP_BUSY_RUN_PHASES as readonly string[]).includes(
    String(phase || "")
  );
}
