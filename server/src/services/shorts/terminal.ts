/**
 * First-party Play Build terminal — E2B PTYs bridged to the browser via SSE + POST.
 * Multiple named PTYs per session keyed by (sessionId, terminalId):
 *   - shell / shell-N — interactive bash (cwd PLAY_WORKSPACE)
 *   - preview — follows /tmp/preview.log (preview server stdout from start.sh)
 */
import type { Response } from "express";
import createHttpError from "http-errors";
import { Sandbox, type CommandHandle } from "e2b";
import { PLAY_WORKSPACE } from "./sandbox.js";
import { connectOwnedActiveSandbox } from "./workspaceFiles.js";
import { createKeyedAsyncLock } from "./keyedAsyncLock.js";

const RECENT_MAX_BYTES = 64 * 1024;
const INPUT_MAX_BYTES = 16 * 1024;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_SHELL_TABS = 6;
const PREVIEW_LOG_PATH = "/tmp/preview.log";

export type TerminalKind = "shell" | "preview";

export type TerminalTabInfo = {
  id: string;
  label: string;
  kind: TerminalKind;
  readOnly: boolean;
  open: boolean;
};

type SseWriter = (event: string, payload: unknown) => void;

type SessionTerminal = {
  sessionId: string;
  terminalId: string;
  kind: TerminalKind;
  anonymousId: string;
  sandboxId: string;
  sandbox: Sandbox;
  pid: number;
  handle: CommandHandle;
  cwd: string;
  cols: number;
  rows: number;
  subscribers: Map<string, SseWriter>;
  recent: Buffer[];
  recentBytes: number;
  exited: boolean;
  exitCode?: number | null;
  readOnly: boolean;
};

/** Map key: `${sessionId}:${terminalId}` */
const terminals = new Map<string, SessionTerminal>();
const withTerminalSessionLock = createKeyedAsyncLock();

function termKey(sessionId: string, terminalId: string): string {
  return `${sessionId}:${terminalId}`;
}

function parseShellIndex(terminalId: string): number | null {
  if (terminalId === "shell") return 1;
  const m = /^shell-(\d+)$/.exec(terminalId);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 2 ? n : null;
}

/**
 * Normalize / validate terminalId. Defaults to `shell`.
 * Allowed: `shell`, `shell-2`…`shell-N` (N <= MAX_SHELL_TABS), `preview`.
 */
export function normalizeTerminalId(raw: unknown): string {
  const id =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : "shell";
  if (id === "preview") return "preview";
  if (id === "shell") return "shell";
  const idx = parseShellIndex(id);
  if (idx != null && idx <= MAX_SHELL_TABS) return id;
  throw createHttpError(
    400,
    `invalid terminalId (use shell, shell-2…shell-${MAX_SHELL_TABS}, or preview)`,
  );
}

function kindForTerminalId(terminalId: string): TerminalKind {
  return terminalId === "preview" ? "preview" : "shell";
}

function labelForTerminalId(terminalId: string): string {
  if (terminalId === "preview") return "Preview";
  if (terminalId === "shell") return "Shell";
  const idx = parseShellIndex(terminalId);
  return idx != null ? `Shell ${idx}` : terminalId;
}

function clampSize(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === "number" ? n : parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function pushRecent(term: SessionTerminal, chunk: Buffer) {
  term.recent.push(chunk);
  term.recentBytes += chunk.length;
  while (term.recentBytes > RECENT_MAX_BYTES && term.recent.length > 1) {
    const dropped = term.recent.shift();
    if (dropped) term.recentBytes -= dropped.length;
  }
}

function broadcast(term: SessionTerminal, event: string, payload: unknown) {
  for (const write of term.subscribers.values()) {
    try {
      write(event, payload);
    } catch {
      // subscriber will be cleaned up on close
    }
  }
}

function encodeOut(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function listOpenTerminalIds(sessionId: string): Set<string> {
  const open = new Set<string>();
  const prefix = `${sessionId}:`;
  for (const [key, term] of terminals) {
    if (!key.startsWith(prefix) || term.exited) continue;
    open.add(term.terminalId);
  }
  return open;
}

/**
 * Catalog of known tabs for the session (built-ins + any open extra shells).
 */
export async function listSessionTerminals(opts: {
  sessionId: string;
  anonymousId: string;
}): Promise<{ terminals: TerminalTabInfo[] }> {
  // Ownership check (throws if forbidden / inactive).
  await connectOwnedActiveSandbox(opts.sessionId, opts.anonymousId.trim());
  const open = listOpenTerminalIds(opts.sessionId);
  const ids = new Set<string>(["shell", "preview", ...open]);
  // Order: shell, preview, shell-2…
  const sorted = [...ids].sort((a, b) => {
    const rank = (id: string) => {
      if (id === "shell") return 0;
      if (id === "preview") return 1;
      const n = parseShellIndex(id);
      return n != null ? 10 + n : 100;
    };
    return rank(a) - rank(b);
  });

  return {
    terminals: sorted.map((id) => {
      const kind = kindForTerminalId(id);
      return {
        id,
        label: labelForTerminalId(id),
        kind,
        readOnly: kind === "preview",
        open: open.has(id),
      };
    }),
  };
}

async function disposeTerminal(
  sessionId: string,
  terminalId: string,
  killPty: boolean,
) {
  const key = termKey(sessionId, terminalId);
  const term = terminals.get(key);
  if (!term) return;
  terminals.delete(key);
  term.subscribers.clear();
  if (killPty && !term.exited) {
    try {
      await term.sandbox.pty.kill(term.pid);
    } catch {
      // ignore
    }
  }
  try {
    await term.handle.disconnect();
  } catch {
    // ignore
  }
}

async function disposeAllSessionTerminals(sessionId: string, killPty: boolean) {
  const prefix = `${sessionId}:`;
  const ids: string[] = [];
  for (const key of terminals.keys()) {
    if (key.startsWith(prefix)) {
      ids.push(key.slice(prefix.length));
    }
  }
  await Promise.all(ids.map((id) => disposeTerminal(sessionId, id, killPty)));
}

/**
 * After preview PTY is up, run `tail -F` on the preview log.
 * Safe if the log is missing (template not rebuilt yet) — waits / explains.
 */
function schedulePreviewFollower(term: SessionTerminal) {
  const script = [
    "clear 2>/dev/null || true",
    "echo '══ Preview server (:8080) ══'",
    "echo 'Following preview stdout ( /tmp/preview.log ).'",
    "echo 'Rebuild play/e2b-template if this stays empty on an old image.'",
    "echo ''",
    `touch ${PREVIEW_LOG_PATH} 2>/dev/null || true`,
    `exec tail -n 200 -F ${PREVIEW_LOG_PATH}`,
  ].join("; ");
  const payload = new TextEncoder().encode(`${script}\n`);
  let sent = false;
  const send = () => {
    if (sent || term.exited) return;
    sent = true;
    void term.sandbox.pty.sendInput(term.pid, payload).catch((err) => {
      console.warn(
        `[play/terminal] preview follow failed for ${term.sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  };
  // Bash -i -l needs a moment before accepting input.
  setTimeout(send, 400);
}

/**
 * Create or resume a named PTY for the session.
 */
export async function openSessionTerminal(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId?: string;
  cols?: number;
  rows?: number;
}): Promise<{
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  terminalId: string;
  kind: TerminalKind;
  readOnly: boolean;
  label: string;
}> {
  const terminalId = normalizeTerminalId(opts.terminalId);
  return withTerminalSessionLock(opts.sessionId, () =>
    openSessionTerminalUnlocked({ ...opts, terminalId }),
  );
}

async function openSessionTerminalUnlocked(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId: string;
  cols?: number;
  rows?: number;
}): Promise<{
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  terminalId: string;
  kind: TerminalKind;
  readOnly: boolean;
  label: string;
}> {
  const cols = clampSize(opts.cols, DEFAULT_COLS, 20, 300);
  const rows = clampSize(opts.rows, DEFAULT_ROWS, 5, 120);
  const anonymousId = opts.anonymousId.trim();
  const sessionId = opts.sessionId;
  const terminalId = opts.terminalId;
  const kind = kindForTerminalId(terminalId);
  const readOnly = kind === "preview";
  const key = termKey(sessionId, terminalId);

  const sandbox = await connectOwnedActiveSandbox(sessionId, anonymousId);
  const sandboxId = sandbox.sandboxId;

  const existing = terminals.get(key);
  if (existing && !existing.exited && existing.anonymousId === anonymousId) {
    try {
      if (existing.cols !== cols || existing.rows !== rows) {
        await existing.sandbox.pty.resize(existing.pid, { cols, rows });
        existing.cols = cols;
        existing.rows = rows;
      }
      return {
        pid: existing.pid,
        cwd: existing.cwd,
        cols: existing.cols,
        rows: existing.rows,
        terminalId,
        kind,
        readOnly,
        label: labelForTerminalId(terminalId),
      };
    } catch (err) {
      console.warn(
        `[play/terminal] resume failed for ${key}, recreating:`,
        err instanceof Error ? err.message : err,
      );
      await disposeTerminal(sessionId, terminalId, true);
    }
  } else if (existing) {
    await disposeTerminal(sessionId, terminalId, true);
  }

  if (kind === "preview") {
    try {
      await sandbox.commands.run(`touch ${PREVIEW_LOG_PATH}`, { timeoutMs: 5_000 });
    } catch {
      // best-effort
    }
  }

  const termHolder: { current: SessionTerminal | null } = { current: null };

  const handle = await sandbox.pty.create({
    cols,
    rows,
    cwd: PLAY_WORKSPACE,
    timeoutMs: 0,
    onData: (data) => {
      const term = termHolder.current;
      if (!term) return;
      const buf = Buffer.from(data);
      pushRecent(term, buf);
      broadcast(term, "out", { data: encodeOut(data) });
    },
  });

  const term: SessionTerminal = {
    sessionId,
    terminalId,
    kind,
    anonymousId,
    sandboxId,
    sandbox,
    pid: handle.pid,
    handle,
    cwd: PLAY_WORKSPACE,
    cols,
    rows,
    subscribers: new Map(),
    recent: [],
    recentBytes: 0,
    exited: false,
    readOnly,
  };
  termHolder.current = term;
  terminals.set(key, term);

  if (kind === "preview") {
    schedulePreviewFollower(term);
  }

  void handle
    .wait()
    .then((result) => {
      const current = terminals.get(key);
      if (!current || current.pid !== term.pid) return;
      current.exited = true;
      current.exitCode = result.exitCode;
      broadcast(current, "exit", { exitCode: result.exitCode });
      terminals.delete(key);
      current.subscribers.clear();
    })
    .catch((err) => {
      const current = terminals.get(key);
      if (!current || current.pid !== term.pid) return;
      current.exited = true;
      broadcast(current, "error", {
        message: err instanceof Error ? err.message : "terminal exited",
      });
      terminals.delete(key);
      current.subscribers.clear();
    });

  return {
    pid: term.pid,
    cwd: term.cwd,
    cols: term.cols,
    rows: term.rows,
    terminalId,
    kind,
    readOnly,
    label: labelForTerminalId(terminalId),
  };
}

/**
 * Attach an SSE client to a named PTY output stream.
 * Opens a PTY if none is live for this (session, terminalId).
 */
export async function attachTerminalStream(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId?: string;
  pid?: number;
  res: Response;
}): Promise<void> {
  const { sessionId, res } = opts;
  const anonymousId = opts.anonymousId.trim();
  const terminalId = normalizeTerminalId(opts.terminalId);
  const key = termKey(sessionId, terminalId);

  let term = terminals.get(key);
  if (!term || term.exited || term.anonymousId !== anonymousId) {
    await openSessionTerminal({ sessionId, anonymousId, terminalId });
    term = terminals.get(key);
  }

  if (!term || term.anonymousId !== anonymousId) {
    throw createHttpError(403, "session_forbidden");
  }
  if (term.exited) {
    throw createHttpError(410, "terminal_gone");
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === "function") {
    (res as Response & { flushHeaders: () => void }).flushHeaders();
  }

  const write: SseWriter = (event, payload) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const subId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  write("ready", {
    pid: term.pid,
    cwd: term.cwd,
    terminalId: term.terminalId,
    kind: term.kind,
    readOnly: term.readOnly,
  });

  if (term.recentBytes > 0) {
    const combined = Buffer.concat(term.recent);
    write("out", { data: combined.toString("base64"), replay: true });
  }

  term.subscribers.set(subId, write);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    const current = terminals.get(key);
    current?.subscribers.delete(subId);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
}

function requireLiveTerminal(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId?: string;
  pid: number;
}): SessionTerminal {
  const terminalId = normalizeTerminalId(opts.terminalId);
  const key = termKey(opts.sessionId, terminalId);
  const term = terminals.get(key);
  if (!term || term.exited) {
    throw createHttpError(410, "terminal_gone");
  }
  if (term.anonymousId !== opts.anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (term.pid !== opts.pid) {
    throw createHttpError(409, "terminal_pid_mismatch");
  }
  return term;
}

export async function sendTerminalInput(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId?: string;
  pid: number;
  data: string;
  encoding?: "utf8" | "base64";
}): Promise<void> {
  const term = requireLiveTerminal(opts);

  // Preview is follow-only; ignore keystrokes except we still allow Ctrl+C etc.
  // if the client sends them — readOnly is enforced client-side primarily.

  const encoding = opts.encoding === "base64" ? "base64" : "utf8";
  let bytes: Buffer;
  try {
    bytes =
      encoding === "base64"
        ? Buffer.from(opts.data, "base64")
        : Buffer.from(opts.data, "utf8");
  } catch {
    throw createHttpError(400, "invalid input encoding");
  }
  if (bytes.length === 0) return;
  if (bytes.length > INPUT_MAX_BYTES) {
    throw createHttpError(400, `input too large (max ${INPUT_MAX_BYTES} bytes)`);
  }

  if (term.readOnly) {
    // Allow only interrupt / suspend-ish control bytes so users can stop a stuck follow.
    const allowed = bytes.every((b) => b === 0x03 || b === 0x1a || b === 0x1c);
    if (!allowed) {
      throw createHttpError(403, "preview_terminal_readonly");
    }
  }

  await term.sandbox.pty.sendInput(term.pid, new Uint8Array(bytes));
}

export async function resizeSessionTerminal(opts: {
  sessionId: string;
  anonymousId: string;
  terminalId?: string;
  pid: number;
  cols: number;
  rows: number;
}): Promise<{ cols: number; rows: number }> {
  const term = requireLiveTerminal(opts);
  const cols = clampSize(opts.cols, term.cols, 20, 300);
  const rows = clampSize(opts.rows, term.rows, 5, 120);
  await term.sandbox.pty.resize(term.pid, { cols, rows });
  term.cols = cols;
  term.rows = rows;
  return { cols, rows };
}

/**
 * Drop all in-memory terminals for a session (e.g. on submit). Optionally kill PTYs.
 */
export async function closeSessionTerminal(
  sessionId: string,
  opts?: { killPty?: boolean },
): Promise<void> {
  await disposeAllSessionTerminals(sessionId, opts?.killPty !== false);
}
