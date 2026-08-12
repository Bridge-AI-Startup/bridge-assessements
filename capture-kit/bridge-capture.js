#!/usr/bin/env node
/**
 * Bridge workflow capture hook.
 *
 * Claude Code runs this once per hook event, handing us a JSON payload on
 * stdin. We turn that into one capture event and POST it to Bridge.
 *
 * Design rules (in priority order):
 *  1. NEVER break the candidate's session. Any failure exits 0 and stays quiet.
 *  2. Never block for long. One short-timeout request, then we are done.
 *  3. Everything sent is mirrored to .bridge/sent.jsonl so the candidate can
 *     read exactly what left their machine. Transparency is the whole point.
 *
 * Usage (from .claude/settings.json):
 *   node .bridge/bridge-capture.js <EventName>
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BRIDGE_DIR = path.join(process.cwd(), ".bridge");
const CONFIG_PATH = path.join(BRIDGE_DIR, "config.json");
const QUEUE_PATH = path.join(BRIDGE_DIR, "queue.jsonl");
const MIRROR_PATH = path.join(BRIDGE_DIR, "sent.jsonl");
const SEQ_PATH = path.join(BRIDGE_DIR, "seq");

const SNAPSHOT_STAMP_PATH = path.join(BRIDGE_DIR, "last-snapshot");

const REQUEST_TIMEOUT_MS = 4000;
/**
 * Snapshot cadence. Hooks only fire when the agent is active, so a candidate
 * hand-coding for half an hour would otherwise be invisible until their next
 * prompt. We snapshot on a timer as well as at end-of-turn.
 */
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TEXT = 20_000;
const MAX_SNAPSHOT_FILES = 40;
const MAX_SNAPSHOT_FILE_BYTES = 100_000;
// `.bridge` is our own working directory — snapshotting it would send the
// candidate's queue and local mirror back to us as if it were their code.
const SKIP_DIRS =
  /(^|\/)(node_modules|\.git|\.bridge|dist|build|\.next|coverage|\.venv)(\/|$)/;

// NEVER upload these, even though they are "changed files" in the repo. A
// candidate's .env holds their own API keys; a lockfile is noise; a keyfile is
// a credential. Capture is consented for their WORK, not their secrets.
const SKIP_FILES =
  /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|crt)|id_rsa.*|.*\.log|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/i;

/** Skip anything that looks like a secret or a binary blob. */
function shouldSkipPath(relPath) {
  return SKIP_DIRS.test(relPath) || SKIP_FILES.test(relPath);
}

/** Cheap binary sniff: NUL byte in the first chunk means do not send it. */
function looksBinary(buffer) {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096));
  return probe.includes(0);
}

/** Exit 0 no matter what — a capture failure must never fail the candidate's turn. */
function bail(reason) {
  if (process.env.BRIDGE_CAPTURE_DEBUG === "1") {
    process.stderr.write(`[bridge-capture] ${reason}\n`);
  }
  process.exit(0);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function nextSeq() {
  // Monotonic per-checkout counter; the server uses (session, seq) to dedupe,
  // so a retried queue can never double-insert.
  let current = 0;
  try {
    current = parseInt(fs.readFileSync(SEQ_PATH, "utf8").trim(), 10) || 0;
  } catch {
    current = 0;
  }
  const next = current + 1;
  try {
    fs.writeFileSync(SEQ_PATH, String(next));
  } catch {
    /* non-fatal */
  }
  return next;
}

function truncate(value) {
  if (typeof value !== "string") return value == null ? null : String(value);
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

function gitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** One human-readable line describing what a tool call is doing. */
function summariseToolInput(toolName, input) {
  if (!input || typeof input !== "object") return null;
  if (typeof input.command === "string") return input.command;

  const filePath = input.file_path || input.path;
  if (typeof filePath === "string" && filePath) {
    if (/^Write$/i.test(toolName || "")) {
      const lines =
        typeof input.content === "string" ? input.content.split("\n").length : null;
      return lines ? `${filePath} (${lines} lines)` : filePath;
    }
    if (/^(Edit|MultiEdit)$/i.test(toolName || "")) return `${filePath} (edit)`;
    return filePath;
  }

  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.url === "string") return input.url;
  return null;
}

/**
 * Map a Claude Code hook payload to a Bridge capture event.
 * Unknown events are still forwarded (as "notification") rather than dropped —
 * we would rather store something we do not yet parse than lose it.
 */
function toEvent(eventName, payload) {
  const base = {
    seq: nextSeq(),
    at: new Date().toISOString(),
    toolSessionId: payload.session_id || null,
    cwd: payload.cwd || process.cwd(),
    gitBranch: gitBranch(),
  };

  switch (eventName) {
    case "SessionStart":
      return { ...base, type: "session_start", text: null, payload: {} };

    case "UserPromptSubmit":
      return {
        ...base,
        type: "user_prompt",
        text: truncate(payload.user_prompt || payload.prompt || ""),
        payload: {},
      };

    case "PreToolUse":
      return {
        ...base,
        type: "tool_use",
        toolName: payload.tool_name || null,
        // Keep the full tool input in `payload`: for Write/Edit that is the
        // code itself, which is what gives the interviewer live code state.
        // `text` is the human-readable one-liner for the timeline — a bare
        // "(Write)" with no text leaves a hole in the story a reviewer reads.
        text: truncate(summariseToolInput(payload.tool_name, payload.tool_input)),
        payload: { tool_input: payload.tool_input ?? null },
      };

    case "PostToolUse":
      return {
        ...base,
        type: "tool_result",
        toolName: payload.tool_name || null,
        text: truncate(
          typeof payload.tool_result === "string"
            ? payload.tool_result
            : JSON.stringify(payload.tool_result ?? null)
        ),
        payload: {},
      };

    case "Stop":
      return {
        ...base,
        type: "assistant_message",
        text: truncate(payload.last_assistant_message || ""),
        payload: {},
      };

    case "SessionEnd":
      return { ...base, type: "session_end", text: null, payload: {} };

    default:
      return {
        ...base,
        type: "notification",
        text: truncate(JSON.stringify(payload).slice(0, MAX_TEXT)),
        payload: { hook_event_name: eventName },
      };
  }
}

function appendLine(file, obj) {
  try {
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  } catch {
    /* non-fatal */
  }
}

function readQueue() {
  try {
    return fs
      .readFileSync(QUEUE_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Drop the events we successfully sent, keeping anything appended meanwhile. */
function clearQueued(sentSeqs) {
  try {
    const sent = new Set(sentSeqs);
    const remaining = readQueue().filter((e) => !sent.has(e.seq));
    fs.writeFileSync(
      QUEUE_PATH,
      remaining.map((e) => JSON.stringify(e)).join("\n") +
        (remaining.length ? "\n" : "")
    );
  } catch {
    /* non-fatal */
  }
}

async function post(config, route, body) {
  const res = await fetch(`${config.apiBase}/api/workflow-capture/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.captureToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

/**
 * Files changed vs HEAD, so we also capture work the agent did not do —
 * hand edits, terminal-driven changes, anything outside the Write tool.
 */
function collectChangedFiles() {
  let names = [];
  try {
    const out = execSync("git status --porcelain=v1 --untracked-files=all", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
    }).toString();
    names = out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((p) => p && !shouldSkipPath(p));
  } catch {
    return [];
  }

  const files = [];
  for (const rel of names.slice(0, MAX_SNAPSHOT_FILES)) {
    try {
      const stat = fs.statSync(rel);
      if (!stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES) continue;
      const buf = fs.readFileSync(rel);
      if (looksBinary(buf)) continue;
      files.push({ path: rel, content: buf.toString("utf8") });
    } catch {
      /* unreadable — skip */
    }
  }
  return files;
}

function snapshotIntervalElapsed() {
  try {
    const last = parseInt(fs.readFileSync(SNAPSHOT_STAMP_PATH, "utf8").trim(), 10);
    return !Number.isFinite(last) || Date.now() - last >= SNAPSHOT_INTERVAL_MS;
  } catch {
    return true;
  }
}

async function sendSnapshot(config, reason) {
  try {
    const files = collectChangedFiles();
    if (files.length === 0) return;
    await post(config, "snapshot", { files, reason });
    fs.writeFileSync(SNAPSHOT_STAMP_PATH, String(Date.now()));
  } catch {
    /* non-fatal — the next hook will try again */
  }
}

async function main() {
  const eventName = process.argv[2] || "Unknown";
  const config = readConfig();
  if (!config?.captureToken || !config?.apiBase) {
    bail("no config — run `node .bridge/setup.js` first");
  }

  // `Snapshot` is not a Claude Code hook — it is our own timer/watch entry
  // point. Take the snapshot and leave the event stream alone.
  if (eventName === "Snapshot") {
    await sendSnapshot(config, "periodic");
    process.exit(0);
  }

  let payload = {};
  let parseError = null;
  try {
    const stdin = fs.readFileSync(0, "utf8");
    payload = stdin ? JSON.parse(stdin) : {};
  } catch (err) {
    // Record the miss instead of silently emitting an empty event — a reviewer
    // needs to know a turn was lost rather than see a blank one.
    payload = {};
    parseError = err.message;
  }

  const event = toEvent(eventName, payload);
  if (parseError) {
    event.payload = { ...(event.payload || {}), _parseError: parseError };
  }
  appendLine(QUEUE_PATH, event);
  appendLine(MIRROR_PATH, event);

  const queued = readQueue();
  if (queued.length === 0) bail("empty queue");

  try {
    await post(config, "events", { events: queued });
    clearQueued(queued.map((e) => e.seq));
  } catch (err) {
    // Offline or server down: the queue survives and flushes on the next hook.
    bail(`send failed, queued ${queued.length}: ${err.message}`);
  }

  // Snapshot so the interviewer agent sees current code, not just agent edits.
  //   SessionStart  → baseline: what the candidate started from
  //   Stop/SessionEnd → end of turn
  //   any hook, if the timer has elapsed → catches hand-coding between turns
  //   Snapshot        → explicit, for `watch` mode / cron
  const isBoundary =
    eventName === "SessionStart" ||
    eventName === "Stop" ||
    eventName === "SessionEnd" ||
    eventName === "Snapshot";
  if (isBoundary || snapshotIntervalElapsed()) {
    await sendSnapshot(config, eventName === "SessionStart" ? "baseline" : "turn");
  }

  process.exit(0);
}

main().catch((err) => bail(`unexpected: ${err.message}`));
