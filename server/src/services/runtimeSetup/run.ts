import path from "path";
import type { RuntimeConfig } from "./schema.js";
import type { RuntimeSandboxContext } from "./sandbox.js";
import { previewUrlForPort } from "./sandbox.js";
import { applySandboxNetwork } from "./network.js";
import { appendLiveLog, persistLiveLogs } from "./logs.js";
import {
  getRuntimeSetupBuildTimeoutMs,
  getRuntimeSetupHealthWaitMs,
  getRuntimeSetupInstallTimeoutMs,
  getRuntimeSetupRunMaxMs,
} from "./config.js";

const ENV_FILE = "/tmp/runtime-setup.env";
const APP_LOG = "/tmp/runtime-setup-app.log";
const APP_PID = "/tmp/runtime-setup-app.pid";
const CURL_MAX_SECS = 3;
const LISTEN_PROBE_CMD = `(command -v ss >/dev/null && ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null) | awk '{print $NF}' | grep -oE '[0-9]+$' | sort -nu | head -20`;

function bashLc(cmd: string): string {
  const escaped = cmd.replace(/'/g, "'\\''");
  return `bash -lc '${escaped}'`;
}

function resolveCwd(rootDir: string, repoPath: string): string {
  const normalizedRepo = path.posix.normalize(repoPath);
  const trimmed = (rootDir || ".").trim() || ".";
  if (trimmed === ".") return normalizedRepo;
  const candidate = path.posix.normalize(
    path.posix.join(normalizedRepo, trimmed)
  );
  if (
    candidate === normalizedRepo ||
    candidate.startsWith(`${normalizedRepo}/`)
  ) {
    return candidate;
  }
  return normalizedRepo;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseListenPorts(stdout: string): number[] {
  const seen = new Set<number>();
  const ports: number[] = [];
  for (const line of String(stdout || "").split("\n")) {
    const n = Number(line.trim());
    if (!Number.isFinite(n) || n <= 0 || n >= 65536 || n === 22 || n >= 60000) {
      continue;
    }
    if (seen.has(n)) continue;
    seen.add(n);
    ports.push(n);
  }
  return ports;
}

export async function writeRuntimeEnvFile(
  ctx: RuntimeSandboxContext,
  config: RuntimeConfig
): Promise<void> {
  const lines = (config.envVars || [])
    .filter((row) => row.key)
    .map((row) => `${row.key}=${shellQuote(row.value ?? "")}`);
  if (config.port) {
    lines.push(`PORT=${shellQuote(String(config.port))}`);
  }
  const body = `${lines.join("\n")}\n`;
  await ctx.sandbox.files.write(ENV_FILE, body);
}

function withEnv(cmd: string): string {
  return `set -a; [ -f ${ENV_FILE} ] && . ${ENV_FILE}; set +a; ${cmd}`;
}

async function runLogged(
  ctx: RuntimeSandboxContext,
  sessionId: string,
  cmd: string,
  opts: { cwd: string; timeoutMs: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const onChunk = (stream: "stdout" | "stderr") => (data: unknown) => {
    const text = typeof data === "string" ? data : String(data ?? "");
    appendLiveLog(sessionId, stream, text);
  };
  const runOpts = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    requestTimeoutMs: 0,
    onStdout: onChunk("stdout"),
    onStderr: onChunk("stderr"),
  };
  const result = await ctx.run(bashLc(withEnv(cmd)), runOpts as never);
  if (result.stdout) appendLiveLog(sessionId, "stdout", result.stdout);
  if (result.stderr) appendLiveLog(sessionId, "stderr", result.stderr);
  await persistLiveLogs(sessionId);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export async function stopPreviousApp(ctx: RuntimeSandboxContext): Promise<void> {
  await ctx.run(
    bashLc(
      `if [ -f ${APP_PID} ]; then kill "$(cat ${APP_PID})" 2>/dev/null || true; rm -f ${APP_PID}; fi; pkill -f "runtime-setup-app" 2>/dev/null || true`
    ),
    { timeoutMs: 15_000 }
  );
}

async function isAppPidAlive(ctx: RuntimeSandboxContext): Promise<boolean> {
  const r = await ctx.run(
    bashLc(
      `if [ -f ${APP_PID} ]; then pid=$(cat ${APP_PID}); kill -0 "$pid" 2>/dev/null && echo alive || echo dead; else echo missing; fi`
    ),
    { timeoutMs: 8_000 }
  );
  return (r.stdout || "").includes("alive");
}

async function listListenPorts(ctx: RuntimeSandboxContext): Promise<number[]> {
  const listen = await ctx.run(bashLc(LISTEN_PROBE_CMD), { timeoutMs: 10_000 });
  return parseListenPorts(listen.stdout || "");
}

/**
 * Cheap "is the app still serving?" probe, used before reusing a warm sandbox
 * instead of paying for a full reinstall.
 */
export async function appStillListening(
  ctx: RuntimeSandboxContext,
  port: number
): Promise<boolean> {
  try {
    if (!(await isAppPidAlive(ctx))) return false;
    return await portIsOpen(ctx, port);
  } catch {
    return false;
  }
}

async function portIsOpen(
  ctx: RuntimeSandboxContext,
  port: number
): Promise<boolean> {
  const r = await ctx.run(
    bashLc(
      `(echo >/dev/tcp/127.0.0.1/${port}) >/dev/null 2>&1 && echo open || echo closed`
    ),
    { timeoutMs: 5_000 }
  );
  return (r.stdout || "").includes("open");
}

async function dumpAppLog(
  ctx: RuntimeSandboxContext,
  sessionId: string,
  label: string
): Promise<void> {
  const r = await ctx.run(
    bashLc(`tail -n 40 ${APP_LOG} 2>/dev/null || true`),
    { timeoutMs: 8_000 }
  );
  const text = (r.stdout || "").trim();
  if (text) {
    appendLiveLog(sessionId, "stderr", `${label}\n${text}`);
  } else {
    appendLiveLog(sessionId, "system", `${label} (app log empty)`);
  }
}

async function curlHealth(
  ctx: RuntimeSandboxContext,
  url: string
): Promise<{ ok: boolean; detail: string }> {
  const cmd = `curl -sS -o /dev/null -w '%{http_code}' -m ${CURL_MAX_SECS} ${JSON.stringify(url)}`;
  const r = await ctx.run(bashLc(cmd), { cwd: "/", timeoutMs: 6_000 });
  const code = Number(String(r.stdout || "").trim());
  if (r.exitCode === 0 && code > 0 && code < 500) {
    return { ok: true, detail: `HTTP ${code}` };
  }
  const err = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 160);
  return { ok: false, detail: err || "no response" };
}

async function waitForHealth(input: {
  ctx: RuntimeSandboxContext;
  sessionId: string;
  origin: string;
  port: number;
  healthPath: string | null;
  shouldAbort?: () => Promise<boolean>;
  onHeartbeat?: (summary: string) => Promise<void>;
  maxWaitMs?: number;
}): Promise<{ ok: boolean; summary: string; httpOk: boolean; aborted?: boolean }> {
  const { ctx, sessionId, origin, port, healthPath, shouldAbort, onHeartbeat } =
    input;
  const maxWaitMs = Math.max(
    1_000,
    Math.min(input.maxWaitMs ?? Number.POSITIVE_INFINITY, getRuntimeSetupHealthWaitMs())
  );
  const paths = healthPath
    ? [healthPath]
    : ["/health", "/api/health", "/"];
  const t0 = Date.now();
  let last = "no response";
  let lastAppDump = "";

  while (Date.now() - t0 < maxWaitMs) {
    if (shouldAbort && (await shouldAbort())) {
      return {
        ok: false,
        summary: "Run aborted (environment restarted or finalized).",
        httpOk: false,
        aborted: true,
      };
    }

    const remaining = Math.max(
      0,
      Math.round((maxWaitMs - (Date.now() - t0)) / 1000)
    );
    if (!(await isAppPidAlive(ctx))) {
      await dumpAppLog(ctx, sessionId, "Start process exited.");
      return {
        ok: false,
        summary: `Process exited before the app was reachable at ${origin}.`,
        httpOk: false,
      };
    }

    const tcpOpen = await portIsOpen(ctx, port);
    let httpOk = false;
    let okUrl = "";
    for (const pathHint of paths) {
      const url = `${origin}${pathHint.startsWith("/") ? pathHint : `/${pathHint}`}`;
      const res = await curlHealth(ctx, url);
      last = res.detail;
      if (res.ok) {
        httpOk = true;
        okUrl = url;
        break;
      }
    }
    if (httpOk) {
      return {
        ok: true,
        summary: `App responded at ${okUrl} (${Math.round((Date.now() - t0) / 1000)}s).`,
        httpOk: true,
      };
    }

    const primary = paths[0];
    const url = `${origin}${primary.startsWith("/") ? primary : `/${primary}`}`;
    if (tcpOpen) {
      const summary = `Port ${port} is listening; ${url} returned ${last}. Showing preview anyway.`;
      appendLiveLog(sessionId, "system", summary);
      return { ok: true, summary, httpOk: false };
    }

    const heartbeat = `Waiting for ${url} (${remaining}s left): ${last}`;
    appendLiveLog(sessionId, "system", heartbeat);
    await onHeartbeat?.(heartbeat);

    const logDump = await ctx.run(
      bashLc(`tail -n 8 ${APP_LOG} 2>/dev/null || true`),
      { timeoutMs: 8_000 }
    );
    const appTail = (logDump.stdout || "").trim();
    if (appTail && appTail !== lastAppDump) {
      appendLiveLog(sessionId, "stderr", appTail);
      lastAppDump = appTail;
    }
    await persistLiveLogs(sessionId);
    await new Promise((r) => setTimeout(r, 2_000));
  }

  return {
    ok: false,
    summary: `App did not respond at ${origin} within ${Math.round(maxWaitMs / 1000)}s (${last}).`,
    httpOk: false,
  };
}

export type RunDeadline = {
  /** Milliseconds left in the whole-run budget (can go negative). */
  msLeft: () => number;
  expired: () => boolean;
  /** A step never gets more time than the run has left. */
  stepTimeout: (limitMs: number) => number;
};

/**
 * Whole-run budget. Per-step timeouts alone let install + build + health each
 * take their full window, so one run could hold a sandbox far longer than
 * RUNTIME_SETUP_RUN_MAX_MS implies.
 */
export function createRunDeadline(
  startedAtMs: number,
  runMaxMs: number,
  now: () => number = Date.now
): RunDeadline {
  const deadlineAt = startedAtMs + runMaxMs;
  const msLeft = () => deadlineAt - now();
  return {
    msLeft,
    expired: () => msLeft() <= 0,
    stepTimeout: (limitMs: number) => Math.max(1_000, Math.min(limitMs, msLeft())),
  };
}

export type RuntimeRunResult = {
  ok: boolean;
  exitCode: number | null;
  error: string | null;
  port: number | null;
  previewUrl: string | null;
  healthOk: boolean;
  healthSummary: string | null;
  startedAt: Date;
  endedAt: Date;
  aborted?: boolean;
};

export async function executeRuntimeConfig(input: {
  ctx: RuntimeSandboxContext;
  sessionId: string;
  repoPath: string;
  config: RuntimeConfig;
  onPhase: (phase: string) => Promise<void>;
  onHeartbeat?: (summary: string) => Promise<void>;
  shouldAbort?: () => Promise<boolean>;
}): Promise<RuntimeRunResult> {
  const { ctx, sessionId, repoPath, config, onPhase, onHeartbeat, shouldAbort } =
    input;
  const startedAt = new Date();
  const cwd = resolveCwd(config.rootDir, repoPath);

  const runMaxMs = getRuntimeSetupRunMaxMs();
  const { msLeft, expired, stepTimeout } = createRunDeadline(
    startedAt.getTime(),
    runMaxMs
  );

  const abortedResult = (): RuntimeRunResult => ({
    ok: false,
    exitCode: null,
    error: "Run aborted (environment restarted or finalized).",
    port: null,
    previewUrl: null,
    healthOk: false,
    healthSummary: null,
    startedAt,
    endedAt: new Date(),
    aborted: true,
  });

  const deadlineResult = (phase: string): RuntimeRunResult => {
    const message = `Run exceeded the ${Math.round(runMaxMs / 60_000)}-minute limit during ${phase}.`;
    appendLiveLog(sessionId, "system", message);
    return {
      ok: false,
      exitCode: null,
      error: message,
      port: null,
      previewUrl: null,
      healthOk: false,
      healthSummary: null,
      startedAt,
      endedAt: new Date(),
    };
  };

  appendLiveLog(sessionId, "system", `Working directory: ${cwd}`);

  await writeRuntimeEnvFile(ctx, config);
  await stopPreviousApp(ctx);

  await applySandboxNetwork(ctx.sandbox, "install", config.declaredEgressDomains);
  appendLiveLog(sessionId, "system", "Network: install/build egress allowed.");

  if (config.installCommand.trim()) {
    await onPhase("installing");
    appendLiveLog(sessionId, "system", `$ ${config.installCommand}`);
    const install = await runLogged(ctx, sessionId, config.installCommand, {
      cwd,
      timeoutMs: stepTimeout(getRuntimeSetupInstallTimeoutMs()),
    });
    if (shouldAbort && (await shouldAbort())) return abortedResult();
    if (expired()) return deadlineResult("install");
    if (install.exitCode !== 0) {
      const endedAt = new Date();
      return {
        ok: false,
        exitCode: install.exitCode,
        error: `Install failed (exit ${install.exitCode})`,
        port: null,
        previewUrl: null,
        healthOk: false,
        healthSummary: null,
        startedAt,
        endedAt,
      };
    }
  }

  if (config.buildCommand?.trim()) {
    await onPhase("building");
    appendLiveLog(sessionId, "system", `$ ${config.buildCommand}`);
    const build = await runLogged(ctx, sessionId, config.buildCommand, {
      cwd,
      timeoutMs: stepTimeout(getRuntimeSetupBuildTimeoutMs()),
    });
    if (shouldAbort && (await shouldAbort())) return abortedResult();
    if (expired()) return deadlineResult("build");
    if (build.exitCode !== 0) {
      const endedAt = new Date();
      return {
        ok: false,
        exitCode: build.exitCode,
        error: `Build failed (exit ${build.exitCode})`,
        port: null,
        previewUrl: null,
        healthOk: false,
        healthSummary: null,
        startedAt,
        endedAt,
      };
    }
  }

  if (!config.startCommand.trim()) {
    const endedAt = new Date();
    return {
      ok: false,
      exitCode: null,
      error: "Start command is required.",
      port: null,
      previewUrl: null,
      healthOk: false,
      healthSummary: null,
      startedAt,
      endedAt,
    };
  }

  const net = await applySandboxNetwork(
    ctx.sandbox,
    "runtime",
    config.declaredEgressDomains
  );
  appendLiveLog(
    sessionId,
    "system",
    net.applied
      ? "Network: runtime egress locked (declared domains only)."
      : `Network: runtime lock skipped (${net.reason || "unavailable"}).`
  );

  if (config.executionProfile === "cli_stdout") {
    await onPhase("starting");
    appendLiveLog(sessionId, "system", `$ ${config.startCommand}`);
    const cli = await runLogged(ctx, sessionId, config.startCommand, {
      cwd,
      timeoutMs: stepTimeout(120_000),
    });
    const endedAt = new Date();
    const ok = cli.exitCode === 0;
    return {
      ok,
      exitCode: cli.exitCode,
      error: ok ? null : `Command exited ${cli.exitCode}`,
      port: null,
      previewUrl: null,
      healthOk: ok,
      healthSummary: ok
        ? "CLI command completed successfully."
        : `CLI command failed (exit ${cli.exitCode}).`,
      startedAt,
      endedAt,
    };
  }

  await onPhase("starting");
  appendLiveLog(sessionId, "system", `$ ${config.startCommand}  (detached)`);
  const startInner = `nohup bash -c ${JSON.stringify(withEnv(config.startCommand))} >> ${APP_LOG} 2>&1 </dev/null & echo $! > ${APP_PID}`;
  const start = await ctx.run(bashLc(startInner), {
    cwd,
    timeoutMs: 20_000,
  });
  if (start.exitCode !== 0) {
    const endedAt = new Date();
    appendLiveLog(sessionId, "stderr", start.stderr || start.stdout || "start failed");
    return {
      ok: false,
      exitCode: start.exitCode,
      error: `Start failed (exit ${start.exitCode})`,
      port: null,
      previewUrl: null,
      healthOk: false,
      healthSummary: null,
      startedAt,
      endedAt,
    };
  }

  await onPhase("waiting_health");
  await new Promise((r) => setTimeout(r, 1_000));

  if (shouldAbort && (await shouldAbort())) return abortedResult();

  if (!(await isAppPidAlive(ctx))) {
    await dumpAppLog(ctx, sessionId, "Start process exited immediately.");
    const endedAt = new Date();
    return {
      ok: false,
      exitCode: 0,
      error: "Start process exited immediately. Check the app log.",
      port: null,
      previewUrl: null,
      healthOk: false,
      healthSummary: "Process exited before opening a port.",
      startedAt,
      endedAt,
    };
  }

  const detected = await listListenPorts(ctx);
  let port = config.port || null;

  if (port) {
    const configuredOpen = await portIsOpen(ctx, port);
    if (!configuredOpen) {
      const others = detected.filter((p) => p !== port);
      const hint = others.length
        ? `nothing on :${port}, detected :${others.join(", :")}`
        : `nothing on :${port}`;
      appendLiveLog(sessionId, "system", hint);
      await onHeartbeat?.(hint);
      if (others[0]) {
        appendLiveLog(
          sessionId,
          "system",
          `Retrying health checks on detected port ${others[0]}.`
        );
        port = others[0];
      }
    }
  } else {
    port = detected[0] || null;
  }

  if (!port) {
    await dumpAppLog(ctx, sessionId, "No listen port found.");
    const endedAt = new Date();
    return {
      ok: false,
      exitCode: 0,
      error: "Started, but no listen port was found. Set Port in the config.",
      port: null,
      previewUrl: null,
      healthOk: false,
      healthSummary: "No listening port discovered.",
      startedAt,
      endedAt,
    };
  }

  const origin = `http://127.0.0.1:${port}`;
  const health = await waitForHealth({
    ctx,
    sessionId,
    origin,
    port,
    healthPath: config.healthPath,
    shouldAbort,
    onHeartbeat,
    maxWaitMs: msLeft(),
  });

  if (health.aborted) return abortedResult();

  const previewUrl = previewUrlForPort(ctx.sandbox, port);
  appendLiveLog(sessionId, "system", health.summary);
  await persistLiveLogs(sessionId);

  const endedAt = new Date();
  return {
    ok: health.ok,
    exitCode: 0,
    error: health.ok ? null : health.summary,
    port,
    previewUrl: health.ok ? previewUrl : null,
    healthOk: health.httpOk,
    healthSummary: health.summary,
    startedAt,
    endedAt,
  };
}
