import type { Sandbox } from "e2b";
import { getE2bApiKeyOrThrow, runCommand, type GradingSandboxContext } from "../e2b/graderSandbox.js";
import { getRuntimeSetupSandboxTtlMs } from "./config.js";

export type RuntimeSandboxContext = GradingSandboxContext;

export function toRuntimeCtx(sandbox: Sandbox): RuntimeSandboxContext {
  return {
    sandboxId: sandbox.sandboxId,
    sandbox,
    run: (cmd, opts) => runCommand(sandbox, cmd, opts),
  };
}

/**
 * Persistent E2B box for candidate runtime setup.
 * Unlike withGradingSandbox, the caller owns kill/pause.
 */
export async function createRuntimeSandbox(metadata: Record<string, string>): Promise<Sandbox> {
  getE2bApiKeyOrThrow();
  const timeoutMs = getRuntimeSetupSandboxTtlMs();

  const { Sandbox } = await import("e2b");
  return Sandbox.create({
    timeoutMs,
    metadata,
    lifecycle: { onTimeout: "pause" },
  } as never);
}

export async function connectRuntimeSandbox(
  sandboxId: string
): Promise<Sandbox> {
  getE2bApiKeyOrThrow();
  const { Sandbox } = await import("e2b");
  return Sandbox.connect(sandboxId, {
    timeoutMs: getRuntimeSetupSandboxTtlMs(),
  });
}

export async function pauseRuntimeSandbox(sandboxId: string): Promise<boolean> {
  getE2bApiKeyOrThrow();
  const { Sandbox } = await import("e2b");
  try {
    return await Sandbox.pause(sandboxId);
  } catch (err) {
    console.warn(
      `[runtime-setup] pause failed for ${sandboxId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export async function killRuntimeSandbox(sandboxId: string): Promise<void> {
  getE2bApiKeyOrThrow();
  const { Sandbox } = await import("e2b");
  try {
    await Sandbox.kill(sandboxId);
  } catch (err) {
    console.warn(
      `[runtime-setup] kill failed for ${sandboxId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export function previewUrlForPort(sandbox: Sandbox, port: number): string {
  return `https://${sandbox.getHost(port)}`;
}
