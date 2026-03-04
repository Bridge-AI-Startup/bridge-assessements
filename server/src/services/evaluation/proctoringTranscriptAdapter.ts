/**
 * Adapter: proctoring raw JSONL transcript → TranscriptEvent[] for the evaluation pipeline.
 * Used when resolving screen recording transcript from a proctoring session instead of dummy data.
 */

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "../capture/storage.js";
import type { TranscriptEvent, ActionType } from "../../types/evaluation.js";

/** Raw segment from proctoring JSONL (matches stitcher/generator output). */
interface RawSegment {
  ts: string;
  ts_end?: string;
  screen?: number;
  region?: string;
  app?: string;
  text_content?: string;
  description?: string;
}

function parseJsonlSegments(jsonl: string): RawSegment[] {
  const segments: RawSegment[] = [];
  const lines = jsonl.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const cleaned = line
      .trim()
      .replace(/^```(?:json|jsonl)?/, "")
      .replace(/^```$/, "")
      .trim();
    if (!cleaned) continue;

    try {
      const parsed = JSON.parse(cleaned) as RawSegment;
      if (parsed.ts && (parsed.text_content != null || parsed.description != null)) {
        segments.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return segments.sort((a, b) => {
    const ta = new Date(a.ts).getTime();
    const tb = new Date(b.ts).getTime();
    return ta - tb;
  });
}

function isoToSecondsSince(iso: string, baseMs: number): number {
  return (new Date(iso).getTime() - baseMs) / 1000;
}

function mapAppToAiTool(app: string | undefined): TranscriptEvent["ai_tool"] {
  if (!app || typeof app !== "string") return null;
  const lower = app.toLowerCase();
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("claude")) return "claude";
  if (lower.includes("chatgpt")) return "chatgpt";
  if (lower.includes("copilot")) return "copilot";
  return null;
}

function inferActionType(seg: RawSegment): ActionType {
  const region = (seg.region || "").toLowerCase();
  const content = (seg.text_content || seg.description || "").trim();

  if (region === "ai_chat") {
    if (/^(Human|User):/im.test(content)) return "ai_prompt";
    if (/^(Assistant|Agent|AI):/im.test(content)) return "ai_response";
    return "ai_prompt";
  }
  if (region === "editor") return "coding";
  if (region === "terminal") return "testing";
  if (region === "browser") return "searching";
  if (region === "file_tree" || region === "other") return "reading";
  return "reading";
}

function extractPromptText(seg: RawSegment): string | null {
  if ((seg.region || "").toLowerCase() !== "ai_chat") return null;
  const content = seg.text_content || seg.description || "";
  const match = content.match(/^(?:Human|User):\s*([\s\S]*?)(?=(?:Assistant|Agent|AI):|$)/im);
  return match ? match[1].trim() : null;
}

/**
 * Convert proctoring raw JSONL transcript to TranscriptEvent[].
 * Uses first segment's ts as base so output ts/ts_end are seconds since session start.
 */
export function proctoringJsonlToTranscriptEvents(jsonl: string): TranscriptEvent[] {
  const segments = parseJsonlSegments(jsonl);
  if (segments.length === 0) return [];

  const baseMs = new Date(segments[0].ts).getTime();

  return segments.map((seg) => {
    const ts = isoToSecondsSince(seg.ts, baseMs);
    const tsEndRaw = seg.ts_end || seg.ts;
    const ts_end = isoToSecondsSince(tsEndRaw, baseMs);
    const action_type = inferActionType(seg);
    const ai_tool = mapAppToAiTool(seg.app);
    const prompt_text = extractPromptText(seg);
    const description =
      seg.text_content?.trim() || seg.description?.trim() || `[${seg.region || "unknown"}]`;

    return {
      ts: Math.max(0, ts),
      ts_end: Math.max(ts, ts_end),
      action_type,
      ai_tool,
      prompt_text,
      search_query: null,
      description,
    };
  });
}

/**
 * Load proctoring session for a submission and return transcript as TranscriptEvent[].
 * Returns null if no session, transcript not completed, or storage read fails.
 */
export async function getProctoringTranscriptForSubmission(
  submissionId: string
): Promise<TranscriptEvent[] | null> {
  const session = await ProctoringSessionModel.findOne({ submissionId });
  if (
    !session ||
    session.transcript?.status !== "completed" ||
    !session.transcript?.storageKey
  ) {
    return null;
  }

  try {
    const storage = getFrameStorage();
    const content = await storage.getTranscript(session.transcript.storageKey);
    const events = proctoringJsonlToTranscriptEvents(content);
    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}
