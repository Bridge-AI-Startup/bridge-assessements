#!/usr/bin/env node
/**
 * Cursor adapter — capture for candidates who use Cursor instead of a CLI agent.
 *
 * Cursor has no hooks and routes model traffic through its own backend, so the
 * only capture surface is the chat store it keeps locally in SQLite. This reads
 * that store, extracts the conversation for the current project, and posts it
 * through the same ingest endpoint the hooks use.
 *
 *   node .bridge/cursor-adapter.js --probe    # report what's there, send NOTHING
 *   node .bridge/cursor-adapter.js            # extract + upload
 *   node .bridge/cursor-adapter.js --watch    # poll every 30s during the session
 *
 * IMPORTANT — this schema is reverse-engineered, not documented by Cursor, and
 * the key names have already changed once (2.6 → 3.0). Treat every read as
 * best-effort: when a pattern stops matching we report it and fall back to the
 * git snapshot rather than failing the assessment. Always run --probe on a new
 * Cursor version before relying on it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const BRIDGE_DIR = path.join(process.cwd(), ".bridge");
const CONFIG_PATH = path.join(BRIDGE_DIR, "config.json");
const STATE_PATH = path.join(BRIDGE_DIR, "cursor-state.json");
const MIRROR_PATH = path.join(BRIDGE_DIR, "sent.jsonl");

const MAX_TEXT = 20_000;
const WATCH_INTERVAL_MS = 30_000;

/** Cursor's per-platform application-support directory. */
function cursorRoot() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Cursor", "User");
  }
  return path.join(home, ".config", "Cursor", "User");
}

function globalDbPath() {
  return path.join(cursorRoot(), "globalStorage", "state.vscdb");
}

function haveSqlite() {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Query a copy of the DB. Cursor holds a lock on the live file, and we must
 * never write to a candidate's own database — copying is both safer and the
 * only reliable way to read while Cursor is open.
 */
function query(dbPath, sql) {
  const tmp = path.join(os.tmpdir(), `bridge-cursor-${process.pid}.db`);
  try {
    fs.copyFileSync(dbPath, tmp);
    const out = execFileSync("sqlite3", ["-json", tmp, sql], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 60_000,
    }).toString();
    return out.trim() ? JSON.parse(out) : [];
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}-wal`, { force: true });
    fs.rmSync(`${tmp}-shm`, { force: true });
  }
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

/** Report structure only — key prefixes and counts, never message contents. */
function probe() {
  const db = globalDbPath();
  console.log(`\nCursor store: ${db}`);
  if (!fs.existsSync(db)) {
    console.log("  ✗ not found — Cursor may not be installed for this user.\n");
    return;
  }
  const sizeMb = (fs.statSync(db).size / 1e6).toFixed(0);
  console.log(`  ✓ found (${sizeMb} MB)`);

  if (!haveSqlite()) {
    console.log("  ✗ sqlite3 CLI not available — cannot read.\n");
    return;
  }

  let tables = [];
  try {
    tables = query(db, "SELECT name FROM sqlite_master WHERE type='table';").map(
      (r) => r.name
    );
  } catch (err) {
    console.log(`  ✗ could not open: ${err.message}\n`);
    return;
  }
  console.log(`  tables: ${tables.join(", ") || "(none)"}`);

  if (!tables.includes("cursorDiskKV")) {
    console.log(
      "  ⚠ no cursorDiskKV table — this Cursor version stores chats differently.\n"
    );
    return;
  }

  const prefixes = query(
    db,
    `SELECT substr(key,1,instr(key||':',':')-1) AS prefix, COUNT(*) AS n
     FROM cursorDiskKV GROUP BY prefix ORDER BY n DESC LIMIT 15;`
  );
  console.log("\n  key prefixes (structure only — no message text read):");
  for (const p of prefixes) console.log(`    ${String(p.n).padStart(7)}  ${p.prefix}`);

  const known = ["composerData", "bubbleId"];
  const present = known.filter((k) => prefixes.some((p) => p.prefix === k));
  console.log(
    present.length === known.length
      ? "\n  ✓ expected chat keys present — extraction should work.\n"
      : `\n  ⚠ expected keys missing (${known.filter((k) => !present.includes(k)).join(", ")}). Schema likely changed; extraction may return nothing.\n`
  );
}

/** Pull message text out of a bubble record, tolerating field-name drift. */
function bubbleToMessage(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const text =
    obj.text ??
    obj.richText ??
    obj.content ??
    (Array.isArray(obj.parts) ? obj.parts.filter((p) => typeof p === "string").join("") : null);
  if (!text || typeof text !== "string" || !text.trim()) return null;

  // Cursor marks role with `type` (1 = user, 2 = assistant) in known versions;
  // fall back to an explicit role field if that ever changes.
  const role =
    obj.role === "user" || obj.type === 1
      ? "user"
      : obj.role === "assistant" || obj.type === 2
        ? "assistant"
        : "unknown";

  return {
    role,
    text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
    createdAt: obj.createdAt ?? obj.timestamp ?? null,
  };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { sentKeys: [] };
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

/**
 * Extract conversation bubbles we have not already sent.
 * Returns events in the same shape the hook script produces, so the server
 * ingest path is identical for Cursor and Claude Code.
 */
function extractNewEvents(sinceKeys) {
  const db = globalDbPath();
  if (!fs.existsSync(db) || !haveSqlite()) return [];

  let rows = [];
  try {
    rows = query(
      db,
      `SELECT key, value FROM cursorDiskKV
       WHERE key LIKE 'bubbleId:%' ORDER BY rowid DESC LIMIT 400;`
    );
  } catch {
    return [];
  }

  const seen = new Set(sinceKeys);
  const events = [];
  // rowid DESC gives newest first; flip so the transcript reads forwards.
  for (const row of rows.reverse()) {
    if (seen.has(row.key)) continue;
    const msg = bubbleToMessage(row.value);
    if (!msg || msg.role === "unknown") continue;
    events.push({
      key: row.key,
      type: msg.role === "user" ? "user_prompt" : "assistant_message",
      text: msg.text,
      at: msg.createdAt ? new Date(msg.createdAt).toISOString() : new Date().toISOString(),
      toolSessionId: row.key.split(":")[1] || null,
      cwd: process.cwd(),
    });
  }
  return events;
}

async function upload(config, events) {
  if (events.length === 0) return 0;
  // Continue the same seq space the hook script uses so the server's
  // (session, seq) dedupe still applies.
  const seqPath = path.join(BRIDGE_DIR, "seq");
  let seq = 0;
  try {
    seq = parseInt(fs.readFileSync(seqPath, "utf8").trim(), 10) || 0;
  } catch {
    seq = 0;
  }

  const payload = events.map((e) => {
    seq += 1;
    const { key, ...rest } = e;
    return { ...rest, seq, payload: { source: "cursor", bubbleKey: key } };
  });

  const res = await fetch(`${config.apiBase}/api/workflow-capture/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.captureToken}`,
    },
    body: JSON.stringify({ events: payload }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  fs.writeFileSync(seqPath, String(seq));
  for (const e of payload) {
    try {
      fs.appendFileSync(MIRROR_PATH, JSON.stringify(e) + "\n");
    } catch {
      /* non-fatal */
    }
  }
  return payload.length;
}

async function syncOnce(config) {
  const state = readState();
  const events = extractNewEvents(state.sentKeys || []);
  if (events.length === 0) return 0;
  const sent = await upload(config, events);
  const keys = new Set(state.sentKeys || []);
  for (const e of events) keys.add(e.key);
  // Bound the memory of what we have sent; 5k keys is far more than a session.
  writeState({ sentKeys: Array.from(keys).slice(-5000) });
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
    console.log("Watching Cursor chat store (Ctrl-C to stop)…");
    for (;;) {
      try {
        const n = await syncOnce(config);
        if (n > 0) console.log(`  +${n} message(s)`);
      } catch (err) {
        console.log(`  (sync failed: ${err.message})`);
      }
      await new Promise((r) => setTimeout(r, WATCH_INTERVAL_MS));
    }
  }

  try {
    const n = await syncOnce(config);
    console.log(
      n > 0
        ? `Uploaded ${n} Cursor message(s).`
        : "No new Cursor messages found. Run with --probe to check the schema."
    );
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
