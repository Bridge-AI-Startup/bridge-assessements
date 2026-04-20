/**
 * E2B cloud sandboxes for running untrusted candidate code during grading.
 * Requires E2B_API_KEY (see server/config.env.example).
 *
 * Docs: https://e2b.dev/docs
 */
import {
  Sandbox,
  CommandExitError,
  type CommandResult,
  type CommandStartOpts,
} from "e2b";

export type GradingSandboxContext = {
  sandboxId: string;
  sandbox: Sandbox;
  /**
   * Runs a shell command and always resolves with stdout/stderr/exitCode.
   * (The E2B SDK throws {@link CommandExitError} on non-zero exit; we normalize that.)
   */
  run: (cmd: string, opts?: CommandStartOpts) => Promise<CommandResult>;
};

const DEFAULT_SANDBOX_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function isE2bConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

export function getE2bApiKeyOrThrow(): string {
  const key = process.env.E2B_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "E2B_API_KEY is not set. Add it to server/config.env (see config.env.example).",
    );
  }
  return key;
}

/**
 * Run a shell command in the sandbox without throwing on non-zero exit codes.
 *
 * E2B has multiple limits (see SDK `CommandStartOpts`):
 * - **timeoutMs** — max time the command may run (SDK default 60s).
 * - **requestTimeoutMs** — max time the API/gRPC stream for `commands.run` may stay open (SDK default 60s).
 *   Long installs keep the stream open >60s → `deadline_exceeded` even if sandbox lifetime is 15+ minutes.
 * Passing **0** disables that limit (E2B docs). We default both to **0** unless the caller sets them.
 */
export async function runCommand(
  sandbox: Sandbox,
  cmd: string,
  opts?: CommandStartOpts,
): Promise<CommandResult> {
  const o = opts ?? {};
  const merged: CommandStartOpts = {
    ...o,
    timeoutMs: o.timeoutMs !== undefined ? o.timeoutMs : 0,
    requestTimeoutMs:
      o.requestTimeoutMs !== undefined ? o.requestTimeoutMs : 0,
  };
  try {
    return await sandbox.commands.run(cmd, merged);
  } catch (e) {
    if (e instanceof CommandExitError) {
      return {
        exitCode: e.exitCode,
        stdout: e.stdout,
        stderr: e.stderr,
        error: e.error,
      };
    }
    throw e;
  }
}

export type WithGradingSandboxOptions = {
  /** Max time the sandbox stays alive (Hobby tier max 1h; Pro up to 24h). */
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

/**
 * Creates an E2B sandbox, runs `fn`, then always kills the sandbox.
 * Use this for grading flows so sandboxes are not left running.
 */
export async function withGradingSandbox<T>(
  fn: (ctx: GradingSandboxContext) => Promise<T>,
  options: WithGradingSandboxOptions = {},
): Promise<T> {
  getE2bApiKeyOrThrow();

  const { timeoutMs = DEFAULT_SANDBOX_TIMEOUT_MS, metadata } = options;

  const sandbox = await Sandbox.create({
    timeoutMs,
    metadata,
  });

  const ctx: GradingSandboxContext = {
    sandboxId: sandbox.sandboxId,
    sandbox,
    run: (cmd, opts) => runCommand(sandbox, cmd, opts),
  };

  try {
    return await fn(ctx);
  } finally {
    try {
      await sandbox.kill();
    } catch (killErr) {
      console.error(
        `[e2b] Failed to kill sandbox ${sandbox.sandboxId}:`,
        killErr,
      );
    }
  }
}
