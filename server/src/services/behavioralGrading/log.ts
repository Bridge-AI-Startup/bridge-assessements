/**
 * Milestone logs for behavioral grading (always on — use `[behavioral]` to grep).
 * Set BEHAVIORAL_GRADING_LOG=0 to silence.
 *
 * A run should call `createBehavioralLogger({ submissionId })` and `runAsync`
 * so every line — including those from helpers that only call `behavioralInfo`
 * — carries the submission id. That is what makes one grading run greppable
 * on a shared Render log.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type BehavioralLogContext = {
  submissionId?: string;
  source?: string;
};

const storage = new AsyncLocalStorage<BehavioralLogContext>();

function isSilenced(): boolean {
  return process.env.BEHAVIORAL_GRADING_LOG === "0";
}

export function behavioralInfo(
  phase: string,
  detail?: Record<string, unknown>
): void {
  if (isSilenced()) return;
  const ctx = storage.getStore();
  const merged: Record<string, unknown> = {
    ...(ctx?.submissionId ? { submissionId: ctx.submissionId } : {}),
    ...(ctx?.source ? { source: ctx.source } : {}),
    ...(detail ?? {}),
  };
  const ts = new Date().toISOString();
  const extra = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : "";
  console.log(`[behavioral ${ts}] ${phase}${extra}`);
}

export type BehavioralLogger = {
  context: BehavioralLogContext;
  info: (phase: string, detail?: Record<string, unknown>) => void;
  run: <T>(fn: () => T) => T;
  runAsync: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function createBehavioralLogger(
  context: BehavioralLogContext
): BehavioralLogger {
  return {
    context,
    info(phase, detail) {
      behavioralInfo(phase, { ...context, ...detail });
    },
    run(fn) {
      return storage.run(context, fn);
    },
    runAsync(fn) {
      return storage.run(context, fn);
    },
  };
}

export function withBehavioralLogContext<T>(
  context: BehavioralLogContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

/** Exposed for tests — the context the current async chain will stamp on logs. */
export function getBehavioralLogContext(): BehavioralLogContext | undefined {
  return storage.getStore();
}
