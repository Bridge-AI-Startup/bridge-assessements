#!/usr/bin/env node
/**
 * Print the captured timeline for this project's session.
 *
 *   node capture-kit/view.js            # readable timeline
 *   node capture-kit/view.js --full     # do not truncate message text
 *   node capture-kit/view.js --json     # raw JSON
 *
 * Reads .bridge/config.json for the capture token, so it shows exactly what a
 * candidate would be able to see about their own record.
 */

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(process.cwd(), ".bridge", "config.json");

const COLORS = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  user: "\x1b[36m",
  assistant: "\x1b[35m",
  tool: "\x1b[33m",
  file: "\x1b[32m",
};

const LABELS = {
  session_start: ["SESSION", COLORS.dim],
  session_end: ["END", COLORS.dim],
  user_prompt: ["PROMPT", COLORS.user],
  assistant_message: ["REPLY", COLORS.assistant],
  tool_use: ["TOOL", COLORS.tool],
  tool_result: ["RESULT", COLORS.dim],
  notification: ["NOTE", COLORS.dim],
};

function clip(text, full) {
  if (!text) return "";
  const oneLine = text.replace(/\s*\n\s*/g, " ⏎ ");
  if (full || oneLine.length <= 140) return oneLine;
  return `${oneLine.slice(0, 140)}…`;
}

function timeOf(iso) {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return "--:--:--";
  }
}

async function main() {
  const full = process.argv.includes("--full");
  const asJson = process.argv.includes("--json");

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    console.error(
      "No .bridge/config.json in this folder.\nRun `node capture-kit/setup.js <token>` here first."
    );
    process.exit(1);
  }

  let data;
  try {
    const res = await fetch(`${config.apiBase}/api/workflow-capture/me`, {
      headers: { Authorization: `Bearer ${config.captureToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error(`Could not fetch record: ${err.message}`);
    console.error(`(is the server running at ${config.apiBase}?)`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const { bold, dim, reset, file: fileColor } = COLORS;
  console.log(
    `\n${bold}Capture session ${data.sessionId}${reset}  ${dim}(${data.status})${reset}`
  );
  console.log(
    `${dim}${data.stats.promptCount} prompts · ${data.stats.toolUseCount} tool calls · ${data.stats.totalEvents} events${reset}\n`
  );

  if (data.events.length === 0) {
    console.log(`${dim}No events captured yet.${reset}\n`);
  }

  for (const e of data.events) {
    const [label, color] = LABELS[e.type] || ["?", dim];
    const tool = e.tool ? `${dim}(${e.tool})${reset} ` : "";
    const text = clip(e.text, full);
    console.log(
      `${dim}${timeOf(e.at)}${reset}  ${color}${label.padEnd(7)}${reset} ${tool}${text}${
        e.truncated ? ` ${dim}[truncated]${reset}` : ""
      }`
    );
  }

  if (data.files?.length) {
    console.log(`\n${bold}Code state${reset} ${dim}(${data.files.length} files)${reset}`);
    for (const f of data.files) {
      const origin =
        f.origin === "agent"
          ? `${fileColor}agent-written${reset}`
          : `${dim}snapshot${reset}`;
      console.log(
        `  ${f.path.padEnd(40)} ${String(f.sizeBytes).padStart(7)}b  ${origin}  ${dim}rev ${f.revision}${reset}`
      );
    }
  }
  console.log();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
