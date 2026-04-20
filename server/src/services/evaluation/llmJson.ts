import { jsonrepair } from "jsonrepair";

/**
 * Extract the first top-level `{ ... }` from text using brace depth, respecting JSON string literals.
 * Avoids greedy `/\{[\s\S]*\}/` grabbing from the first `{` to the last `}` in the buffer when
 * multiple objects exist or when `}` appears inside strings.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * LLMs sometimes echo tool-style lines instead of JSON, e.g.
 * `read_file (server/src/controllers/submission.ts):` — recover a minimal object for Zod.
 */
function tryCoerceProseToolCall(trimmed: string): unknown | null {
  const readFile = trimmed.match(/read_file\s*\(\s*([^)]+)\s*\)/i);
  if (readFile?.[1]) {
    const relativePath = readFile[1].trim().replace(/^['"]|['"]$/g, "");
    if (relativePath.length > 0) {
      return { step: "read_file", relativePath };
    }
  }
  return null;
}

/**
 * Parse model JSON: balanced object extraction + jsonrepair (fixes bad strings, trailing commas, etc.).
 */
export function parseJsonObjectLenient(raw: string): unknown {
  const trimmed = raw.trim();
  const extracted =
    extractFirstJsonObject(trimmed) ??
    trimmed.match(/\{[\s\S]*\}/)?.[0] ??
    trimmed;
  try {
    return JSON.parse(jsonrepair(extracted));
  } catch (e1) {
    try {
      return JSON.parse(extracted);
    } catch {
      const coerced = tryCoerceProseToolCall(trimmed);
      if (coerced !== null) {
        return coerced;
      }
      const snippet =
        extracted.slice(0, 800) + (extracted.length > 800 ? "…" : "");
      throw new Error(
        `JSON parse failed: ${e1 instanceof Error ? e1.message : String(e1)}. Snippet: ${snippet}`
      );
    }
  }
}

/**
 * Normalise LLM JSON so schema parsing never fails with "Expected object, received array".
 * When the schema expects an object, the model sometimes returns an array (e.g. [{ "valid": true }]
 * or multiple items). We unwrap to the first object so Zod receives an object.
 */
export function unwrapObject(parsed: unknown): unknown {
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed[0] !== null &&
    typeof parsed[0] === "object" &&
    !Array.isArray(parsed[0])
  ) {
    return parsed[0];
  }
  return parsed;
}
