#!/usr/bin/env node
/**
 * Codex CLI adapter.
 *
 * Codex has a hooks system like Claude Code, but its repo-local hook config is
 * trust-gated and its exact schema is not something we have been able to verify
 * against a running install. So capture for Codex is file-based: it writes a
 * JSONL "rollout" per session under ~/.codex/sessions/, and we read that.
 *
 *   node .bridge/codex-adapter.js --probe    # report what's there, send NOTHING
 *   node .bridge/codex-adapter.js            # import new turns
 *   node .bridge/codex-adapter.js --watch    # poll every 20s while you work
 *
 * Only sessions whose recorded cwd matches this project are imported, so
 * running it here never uploads a candidate's unrelated Codex work.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const BRIDGE_DIR = path.join(process.cwd(), ".bridge");
const CONFIG_PATH = path.join(BRIDGE_DIR, "config.json");
const STATE_PATH = path.join(BRIDGE_DIR, "codex-state.json");
const MIRROR_PATH = path.join(BRIDGE_DIR, "sent.jsonl");
const SEQ_PATH = path.join(BRIDGE_DIR, "seq");

const MAX_TEXT = 20_000;
const WATCH_INTERVAL_MS = 20_000;

function codexSessionsDir() {
  return path.join(os.homedir(), ".codex", "sessions");
}

/** Every rollout-*.jsonl under the YYYY/MM/DD tree, newest first. */
function findRolloutFiles(limit = 40) {
  const root = codexSessionsDir();
  const out = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /\.jsonl$/.test(e.name)) {
        try {
          out.push({ path: p, mtime: fs.statSync(p).mtimeMs });
        } catch {
          /* skip */
        }
      }
    }
  }
  walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

function readJsonl(file) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw
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
}

/**
 * The cwd Codex recorded for this rollout.
 * Lives on the `session_meta` record's payload, with `turn_context` as backup.
 */
function rolloutCwd(records) {
  for (const r of records) {
    if (r?.type === "session_meta" && typeof r.payload?.cwd === "string") {
      return r.payload.cwd;
    }
  }
  for (const r of records) {
    if (r?.type === "turn_context" && typeof r.payload?.cwd === "string") {
      return r.payload.cwd;
    }
  }
  return null;
}

function truncate(text) {
  if (typeof text !== "string") return null;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

/** Flatten a Codex content array (`[{type:"input_text"|"output_text", text}]`). */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content?.text || null;
  return content
    .map((p) => (typeof p === "string" ? p : p?.text || ""))
    .filter(Boolean)
    .join("");
}

/**
 * Map one rollout record to a Bridge event.
 *
 * Verified against Codex rollout files (Aug 2026). Every record is
 * `{timestamp, type, payload}`; the conversation lives in `response_item`
 * records whose `payload.role` is user/assistant. `event_msg` records duplicate
 * the same messages as UI events, so we deliberately read only `response_item`
 * to avoid every turn appearing twice.
 *
 * Unknown record types are skipped rather than guessed at — a wrong mapping is
 * worse than a missing one when a reviewer is judging someone's work.
 */
function toEvent(rec) {
  const at = rec.timestamp || null;
  if (rec.type !== "response_item") return null;
  const p = rec.payload || {};

  if (p.type === "message") {
    const text = truncate(contentText(p.content));
    if (!text) return null;
    if (p.role === "user") return { type: "user_prompt", text, at };
    if (p.role === "assistant") return { type: "assistant_message", text, at };
    return null; // "developer" = injected system context, not the candidate
  }

  if (p.type === "function_call" || p.type === "local_shell_call") {
    const args = p.arguments ?? p.action ?? null;
    let text = null;
    if (typeof args === "string") text = args;
    else if (args && typeof args === "object") {
      text = args.command
        ? [].concat(args.command).join(" ")
        : JSON.stringify(args);
    }
    return { type: "tool_use", toolName: p.name || p.type, text: truncate(text), at };
  }

  if (p.type === "function_call_output" || p.type === "local_shell_call_output") {
    const out = p.output;
    const text = truncate(
      typeof out === "string" ? out : contentText(out) || JSON.stringify(out || "")
    );
    return text ? { type: "tool_result", toolName: p.name || null, text, at } : null;
  }

  return null;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { imported: {} };
  }
}

function probe() {
  const dir = codexSessionsDir();
  console.log(`\nCodex sessions: ${dir}`);
  if (!fs.existsSync(dir)) {
    console.log("  ✗ not found — Codex CLI may not be installed for this user.\n");
    return;
  }
  const files = findRolloutFiles();
  console.log(`  ✓ found ${files.length} rollout file(s)`);
  const here = process.cwd();
  let matching = 0;
  for (const f of files.slice(0, 10)) {
    const recs = readJsonl(f.path);
    const cwd = rolloutCwd(recs);
    const mine = cwd === here;
    if (mine) matching++;
    const parsed = recs.map(toEvent).filter(Boolean).length;
    console.log(
      `    ${mine ? "→" : " "} ${path.basename(f.path)}  records=${String(recs.length).padStart(4)}  parsed=${String(parsed).padStart(4)}  cwd=${cwd || "?"}`
    );
  }
  console.log(
    matching > 0
      ? `\n  ✓ ${matching} rollout(s) belong to this folder — import will pick them up.\n`
      : `\n  ⚠ no rollout recorded a cwd matching ${here}. Run Codex in this folder first, or its schema changed.\n`
  );
}

async function importNew(config) {
  const here = process.cwd();
  const state = readState();
  const files = findRolloutFiles();

  let seq = 0;
  try {
    seq = parseInt(fs.readFileSync(SEQ_PATH, "utf8").trim(), 10) || 0;
  } catch {
    seq = 0;
  }

  let sent = 0;
  for (const f of files) {
    const recs = readJsonl(f.path);
    if (rolloutCwd(recs) !== here) continue;

    const already = state.imported[f.path] || 0;
    if (recs.length <= already) continue;

    const events = [];
    for (let i = already; i < recs.length; i++) {
      const e = toEvent(recs[i]);
      if (!e) continue;
      seq += 1;
      events.push({
        seq,
        at: e.at || new Date().toISOString(),
        type: e.type,
        toolName: e.toolName || null,
        text: e.text || null,
        cwd: here,
        payload: { source: "codex", rollout: path.basename(f.path) },
      });
    }
    if (events.length === 0) {
      state.imported[f.path] = recs.length;
      continue;
    }

    const res = await fetch(`${config.apiBase}/api/workflow-capture/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.captureToken}`,
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    state.imported[f.path] = recs.length;
    sent += events.length;
    for (const e of events) {
      try {
        fs.appendFileSync(MIRROR_PATH, JSON.stringify(e) + "\n");
      } catch {
        /* non-fatal */
      }
    }
  }

  try {
    fs.writeFileSync(SEQ_PATH, String(seq));
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
  return sent;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--probe")) {
    probe();
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    console.error("No .bridge/config.json — run capture-kit/setup.js first.");
    process.exit(1);
  }

  if (args.includes("--watch")) {
    console.log("Watching Codex sessions (Ctrl-C to stop)…");
    for (;;) {
      try {
        const n = await importNew(config);
        if (n > 0) console.log(`  +${n} event(s)`);
      } catch (err) {
        console.log(`  (import failed: ${err.message})`);
      }
      await new Promise((r) => setTimeout(r, WATCH_INTERVAL_MS));
    }
  }

  try {
    const n = await importNew(config);
    console.log(
      n > 0
        ? `Imported ${n} Codex event(s).`
        : "No new Codex activity for this folder. Run with --probe to check."
    );
  } catch (err) {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
