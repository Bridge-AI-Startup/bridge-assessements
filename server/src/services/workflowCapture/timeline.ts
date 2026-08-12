/**
 * Adapter: workflow capture events → `TranscriptEvent[]` for the evaluation pipeline.
 *
 * The grading engine in `services/evaluation/` already does evidence-first,
 * timestamp-cited scoring — it just expects a screen-recording transcript. This
 * translates the (much richer, much cheaper) hook stream into the same shape, so
 * grounder → evaluator → judge all work unchanged.
 *
 * Timestamps are **session-relative seconds**, which are always defined and
 * monotonic. Converting a citation to a position in the screen recording is a
 * separate lookup (`videoOffsetForSessionSeconds`) so evidence stays valid on
 * sessions that were never recorded.
 */

import type { TranscriptEvent, ActionType } from "../../types/evaluation.js";
import { offsetIntoVideo, type VideoSegment } from "./video.js";

export interface WorkflowEventLike {
  _id?: unknown;
  at: Date | string;
  type: string;
  toolName?: string | null;
  text?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Commands that indicate the candidate is verifying, not authoring. */
const TEST_COMMAND = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|jest|vitest)\b|\b(pytest|go test|cargo test|rspec|phpunit)\b|\bnpx\s+(jest|vitest|playwright)\b/i;
/** Commands that run the product rather than test it — still verification. */
const RUN_COMMAND = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b|\b(flask|uvicorn|rails s|go run)\b/i;
/** Tools that read rather than change. */
const READ_TOOL = /^(Read|Glob|Grep|NotebookRead|WebFetch|WebSearch|LS)$/i;
const WRITE_TOOL = /^(Write|Edit|MultiEdit|NotebookEdit)$/i;

function toolFor(source: string | null | undefined): TranscriptEvent["ai_tool"] {
  const s = String(source || "").toLowerCase();
  if (s.includes("cursor")) return "cursor";
  if (s.includes("codex") || s.includes("copilot")) return "copilot";
  if (s.includes("chatgpt")) return "chatgpt";
  return "claude";
}

/**
 * Classify one captured event into the evaluation pipeline's action vocabulary.
 * Deliberately conservative: anything ambiguous becomes "coding" rather than
 * inventing a category the grounder's `relevant_action_types` filter would miss.
 */
export function actionTypeFor(e: WorkflowEventLike): ActionType {
  switch (e.type) {
    case "user_prompt":
      return "ai_prompt";
    case "assistant_message":
      return "ai_response";
    case "screen_context": {
      const label = String((e.payload as any)?.label || "");
      if (label === "browser:search") return "searching";
      if (label === "browser:docs") return "reading";
      if (label === "browser:ai_chat") return "ai_prompt";
      if (label === "cli_agent") return "ai_prompt";
      if (label === "browser:own_app") return "testing";
      if (label === "idle") return "idle";
      return "reading";
    }
    case "tool_use": {
      const tool = String(e.toolName || "");
      const text = String(e.text || "");
      if (READ_TOOL.test(tool)) return "reading";
      if (WRITE_TOOL.test(tool)) return "coding";
      if (TEST_COMMAND.test(text) || RUN_COMMAND.test(text)) return "testing";
      return "coding";
    }
    case "tool_result": {
      const text = String(e.text || "");
      return TEST_COMMAND.test(text) ? "testing" : "reading";
    }
    default:
      return "idle";
  }
}

/** Human-readable line for the judge — this is what the model actually reads. */
function describe(e: WorkflowEventLike): string {
  // Older captures stringified `undefined` into the literal "null"; treat those
  // as empty rather than telling the judge a tool returned the word "null".
  const raw = (e.text || "").trim();
  const text = raw === "null" || raw === "undefined" ? "" : raw;
  switch (e.type) {
    case "user_prompt":
      return `Candidate prompted the AI assistant: "${text}"`;
    case "assistant_message":
      return `AI assistant replied: "${text}"`;
    case "tool_use":
      return `AI ran ${e.toolName || "a tool"}: ${text || "(no detail)"}`;
    case "tool_result":
      return `Result from ${e.toolName || "tool"}: ${text || "(empty)"}`;
    case "screen_context": {
      const label = (e.payload as any)?.label || "screen";
      return `On screen (${label})${text ? `: ${text}` : ""}`;
    }
    case "session_start":
      return "Session started";
    case "session_end":
      return "Session ended";
    default:
      return text || e.type;
  }
}

export interface BuildTimelineOptions {
  /** Session start; ts values are seconds from this instant. */
  startedAt: Date | string;
  /** Minimum silence (seconds) before an explicit idle event is inserted. */
  idleThresholdSeconds?: number;
}

/**
 * Build the evaluation timeline.
 *
 * Idle stretches are inserted explicitly rather than left as holes: "did nothing
 * for eleven minutes" is itself evidence, and a judge cannot cite a gap that is
 * not represented.
 */
export function buildTranscriptEvents(
  events: WorkflowEventLike[],
  options: BuildTimelineOptions
): TranscriptEvent[] {
  const startMs = new Date(options.startedAt).getTime();
  const idleThreshold = options.idleThresholdSeconds ?? 120;
  const sorted = [...events]
    // Screen observations flagged redundant exist for the coverage band only —
    // they restate what the hook stream already proves, and feeding them to the
    // judge as evidence would pad the transcript with "was in the editor".
    .filter((e) => !(e.type === "screen_context" && (e.payload as any)?.redundant))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const out: TranscriptEvent[] = [];
  let prevEndSec: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const ts = Math.max(0, (new Date(e.at).getTime() - startMs) / 1000);
    const next = sorted[i + 1];
    const nextTs = next
      ? Math.max(0, (new Date(next.at).getTime() - startMs) / 1000)
      : ts;
    // Events are instants; give each a nominal span up to the next one so the
    // judge sees duration, capped so one long gap does not swallow a segment.
    const tsEnd = Math.min(nextTs, ts + 60);

    if (prevEndSec != null && ts - prevEndSec >= idleThreshold) {
      out.push({
        ts: Number(prevEndSec.toFixed(2)),
        ts_end: Number(ts.toFixed(2)),
        action_type: "idle",
        ai_tool: null,
        prompt_text: null,
        search_query: null,
        description: `No captured activity for ${Math.round(ts - prevEndSec)}s`,
      });
    }

    const actionType = actionTypeFor(e);
    const source = String((e.payload as any)?.source || "");
    out.push({
      ts: Number(ts.toFixed(2)),
      ts_end: Number(Math.max(tsEnd, ts).toFixed(2)),
      action_type: actionType,
      ai_tool:
        actionType === "ai_prompt" || actionType === "ai_response"
          ? toolFor(source)
          : null,
      prompt_text: e.type === "user_prompt" ? e.text ?? null : null,
      search_query:
        actionType === "searching"
          ? ((e.payload as any)?.detail as string) ?? e.text ?? null
          : null,
      description: describe(e),
    });
    prevEndSec = Math.max(ts, prevEndSec ?? 0);
  }

  return out;
}

/**
 * Map a citation's session-relative seconds onto a position in the screen
 * recording, so a reviewer can click evidence and watch it. Null when the moment
 * falls outside every recorded segment.
 */
export function videoOffsetForSessionSeconds(
  sessionSeconds: number,
  startedAt: Date | string,
  segments: VideoSegment[] | null | undefined
): number | null {
  const wall = new Date(new Date(startedAt).getTime() + sessionSeconds * 1000);
  return offsetIntoVideo(wall, segments);
}
