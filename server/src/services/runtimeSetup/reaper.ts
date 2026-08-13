import RuntimeSetupSessionModel from "../../models/runtimeSetupSession.js";
import {
  getRuntimeSetupIdlePauseMs,
  getRuntimeSetupSandboxTtlMs,
  isBusyRunPhase,
  isRuntimeSetupEnabled,
} from "./config.js";
import { killRuntimeSandbox, pauseRuntimeSandbox } from "./sandbox.js";
import { persistLiveLogs } from "./logs.js";

const TICK_MS = 30_000;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function reapOnce(): Promise<void> {
  if (!isRuntimeSetupEnabled()) return;
  const now = Date.now();
  const idleCutoff = new Date(now - getRuntimeSetupIdlePauseMs());
  const ttlCutoff = new Date(now - getRuntimeSetupSandboxTtlMs());

  const toKill = await RuntimeSetupSessionModel.find({
    status: { $in: ["running", "paused", "provisioning"] },
    e2bSandboxId: { $ne: null },
    $or: [
      { startedAt: { $lte: ttlCutoff } },
      { status: "running", lastActiveAt: { $lte: ttlCutoff } },
    ],
  }).limit(25);

  for (const session of toKill) {
    if (session.status === "dead" || !session.e2bSandboxId) continue;
    await killRuntimeSandbox(session.e2bSandboxId);
    session.status = "dead";
    session.e2bSandboxId = null;
    session.previewUrl = null;
    session.error = "Sandbox TTL exceeded";
    await session.save();
  }

  const toPause = await RuntimeSetupSessionModel.find({
    status: "running",
    e2bSandboxId: { $ne: null },
    lastActiveAt: { $lte: idleCutoff },
    runPhase: { $nin: ["installing", "building", "starting", "waiting_health"] },
  }).limit(25);

  for (const session of toPause) {
    if (session.status === "dead" || !session.e2bSandboxId) continue;
    if (isBusyRunPhase(session.runPhase) || session.status === "provisioning") {
      continue;
    }
    await persistLiveLogs(session._id.toString());
    const ok = await pauseRuntimeSandbox(session.e2bSandboxId);
    if (ok) {
      session.status = "paused";
      session.pausedAt = new Date();
      await session.save();
    }
  }
}

export function startRuntimeSetupReaper(): void {
  if (!isRuntimeSetupEnabled()) return;
  if (intervalId) return;
  intervalId = setInterval(() => {
    reapOnce().catch((err) => {
      console.error("[runtime-setup] reaper tick failed:", err);
    });
  }, TICK_MS);
  console.log(`[runtime-setup] idle/TTL reaper started (every ${TICK_MS}ms)`);
}

export function stopRuntimeSetupReaper(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
