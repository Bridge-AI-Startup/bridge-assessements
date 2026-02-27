import multer from "multer";
import { Request } from "express";

// Configure multer for JSON file uploads
const storage = multer.memoryStorage(); // Store in memory for processing

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ok =
    file.mimetype === "application/json" ||
    file.originalname.endsWith(".json") ||
    file.mimetype === "text/markdown" ||
    file.mimetype === "text/x-markdown" ||
    file.originalname.endsWith(".md");
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error("Only JSON or Markdown (.md) files are allowed"));
  }
};

export const uploadLLMTrace = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
}).single("llmTrace"); // Field name: "llmTrace"

export function parseTraceFile(file: Express.Multer.File): any {
  try {
    const content = file.buffer.toString("utf-8");
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export type ParsedMarkdownTrace = {
  events: Array<{
    prompt: string;
    response: string;
    tokens?: { input?: number; output?: number; total?: number };
    latency?: number;
    cost?: number;
  }>;
  sessionMetadata?: {
    totalTokens?: number;
    totalCost?: number;
    totalTimeMs?: number;
  };
};

/**
 * Parse a markdown conversation into trace events.
 * Supports:
 * - ## User / ## Assistant (or ###)
 * - **User:** / **Assistant:** on a line
 * - Optional metadata block at end: --- with total_tokens, total_cost, total_time_seconds (or total_time_ms)
 */
export function parseTraceMarkdown(file: Express.Multer.File): ParsedMarkdownTrace {
  const content = file.buffer.toString("utf-8");
  const sessionMetadata: ParsedMarkdownTrace["sessionMetadata"] = {};

  // Extract optional metadata block at end (YAML-like or key: value)
  const metadataMatch = content.match(
    /---\s*\n([\s\S]*?)\n---\s*$|##\s*Session\s+Metadata\s*\n([\s\S]*?)(?=\n##\s|$)/im
  );
  let body = content;
  if (metadataMatch) {
    const block = (metadataMatch[1] || metadataMatch[2] || "").trim();
    body = content.replace(metadataMatch[0], "").trim();
    const tokenM = block.match(/total_tokens?:\s*(\d+)/i);
    const costM = block.match(/total_cost:\s*\$?([\d.]+)/i);
    const timeSecM = block.match(/total_time_seconds?:\s*(\d+)/i);
    const timeMsM = block.match(/total_time_ms:\s*(\d+)/i);
    if (tokenM) sessionMetadata.totalTokens = parseInt(tokenM[1], 10);
    if (costM) sessionMetadata.totalCost = parseFloat(costM[1]);
    if (timeMsM) sessionMetadata.totalTimeMs = parseInt(timeMsM[1], 10);
    else if (timeSecM) sessionMetadata.totalTimeMs = parseInt(timeSecM[1], 10) * 1000;
  }

  const events: ParsedMarkdownTrace["events"] = [];
  // Match: ## User / # User, **User** / **Cursor** / **Assistant**, or plain "User:" / "Assistant:" at line start.
  // Use [ \t]* (not \s*) after ** so we don't consume the required newline; Cursor export has **User**\n\n.
  const rolePattern = /(?:^|\n)\s*#{1,6}\s*(User|Assistant|Human|Cursor)\s*:?[ \t]*\n|(?:^|\n)\s*\*\*(User|Assistant|Human|Cursor)\**[ \t]*:?[ \t]*\n|(?:^|\n)\s*(User|Assistant|Human|Cursor)\s*:\s*\n/gim;
  const roleStarts = [...body.matchAll(rolePattern)];
  if (roleStarts.length === 0) {
    throw new Error(
      "Markdown trace must contain User/Assistant sections, e.g. '## User', '## Assistant', '**User**', '**Cursor**', or 'User:' / 'Assistant:' at the start of a line."
    );
  }

  const sections: { role: "user" | "assistant"; start: number; end: number }[] = [];
  for (let i = 0; i < roleStarts.length; i++) {
    const raw = (roleStarts[i][1] || roleStarts[i][2] || roleStarts[i][3] || "").toLowerCase();
    const role = raw.startsWith("human") ? "user" : (raw.startsWith("cursor") ? "assistant" : raw);
    const start = roleStarts[i].index! + (roleStarts[i][0] || "").length;
    const end = i + 1 < roleStarts.length ? roleStarts[i + 1].index! : body.length;
    sections.push({
      role: role.startsWith("user") ? "user" : "assistant",
      start,
      end,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const text = body.slice(sections[i].start, sections[i].end).trim();
    if (!text) continue;
    if (sections[i].role === "user") {
      const next = sections[i + 1];
      const response = next && next.role === "assistant"
        ? body.slice(next.start, next.end).trim()
        : "";
      events.push({ prompt: text, response: response || "(no response)" });
    }
  }

  if (events.length === 0) {
    throw new Error("No User/Assistant turn pairs found in markdown.");
  }

  return { events, sessionMetadata: Object.keys(sessionMetadata).length ? sessionMetadata : undefined };
}
