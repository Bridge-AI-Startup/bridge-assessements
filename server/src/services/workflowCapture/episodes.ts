/**
 * Episode grouping — turning thousands of events into a story.
 *
 * A 90-minute session produces thousands of raw events. That is too granular to
 * grade (a judge reading one `Read` tool call at a time has no idea what the
 * candidate was *trying* to do) and too large for one context. Episodes are the
 * middle layer: ~20-40 coherent stretches of work, each summarised, each
 * carrying back-pointers to the raw events it was built from.
 *
 * The back-pointers are the important part. Every downstream claim resolves to
 * real captured moments, which is what makes a score auditable and what lets a
 * reviewer click a conclusion and watch the footage behind it.
 *
 * This is a text-only pass — no video, no images — so it is cheap regardless of
 * session length.
 */

import { createChatCompletion } from "../langchainAI.js";
import { unwrapObject } from "../evaluation/llmJson.js";
import type { WorkflowEventLike } from "./timeline.js";
import { logTs } from "../../ai/transcript/logger.js";

export interface Episode {
  /** 1-based position in the session. */
  index: number;
  label: string;
  summary: string;
  /** Session-relative seconds. */
  startSeconds: number;
  endSeconds: number;
  /** Indices into the event array this episode was built from. */
  evidenceIndices: number[];
  /** Coarse activity kind, for filtering. */
  kind:
    | "planning"
    | "implementation"
    | "debugging"
    | "verification"
    | "research"
    | "review"
    | "idle"
    | "other";
}

const MAX_EVENTS_IN_PROMPT = 400;
const MAX_TEXT_PER_EVENT = 220;

/**
 * Compact index of the session for the model.
 *
 * Full event text would blow the context on a long session and is not needed:
 * grouping is a structural judgement ("these twelve events are one debugging
 * cycle"), so a truncated preview per event is enough. The model returns
 * indices, and the caller re-attaches full events afterwards.
 */
export function buildEventIndex(
  events: WorkflowEventLike[],
  startedAt: Date | string
): { text: string; usedIndices: number[] } {
  const startMs = new Date(startedAt).getTime();
  // On very long sessions, sample rather than truncate: keeping the first 400
  // events would describe the first twenty minutes and silently discard the
  // rest of the story.
  const stride = Math.max(1, Math.ceil(events.length / MAX_EVENTS_IN_PROMPT));
  const usedIndices: number[] = [];
  const lines: string[] = [];

  for (let i = 0; i < events.length; i += stride) {
    const e = events[i];
    const sec = Math.round((new Date(e.at).getTime() - startMs) / 1000);
    const raw = (e.text || "").replace(/\s+/g, " ").trim();
    const text =
      raw.length > MAX_TEXT_PER_EVENT ? `${raw.slice(0, MAX_TEXT_PER_EVENT)}…` : raw;
    const tool = e.toolName ? `/${e.toolName}` : "";
    lines.push(`${i}\t${sec}s\t${e.type}${tool}\t${text}`);
    usedIndices.push(i);
  }

  return {
    text: lines.join("\n"),
    usedIndices,
  };
}

const SYSTEM_PROMPT = `You segment a developer's captured working session into coherent episodes.

You receive one line per captured event:
  index<TAB>secondsFromStart<TAB>eventType<TAB>truncated text

Group consecutive events into episodes. An episode is a stretch where the person was doing one coherent thing — working through a bug, implementing a feature, reading documentation, verifying a change, planning an approach.

Rules:
1. Every episode must reference the event indices it covers, using the indices given. Never invent an index.
2. Episodes must be in chronological order and must not overlap.
3. Prefer 15-40 episodes for a long session. Do not emit one per event.
4. Rapid alternation between editing and running tests is usually ONE debugging episode, not many.
5. An AI exchange includes the prompt, the response, AND the candidate acting on it.
6. label: at most 8 words, concrete and specific to THIS session — "fixing stale summary counts", not "debugging".
7. summary: 1-3 sentences on what the person was trying to do and how they went about it. Describe what happened; do not praise, criticise, or score.
8. Long stretches of nothing are their own episode with kind "idle".

Return JSON: { "episodes": [ { "label": string, "summary": string, "kind": string, "eventIndices": number[] } ] }
kind is one of: planning, implementation, debugging, verification, research, review, idle, other.`;

/**
 * Group a session's events into episodes.
 * Returns [] rather than throwing when there is too little to segment — a short
 * session is not an error.
 */
export async function groupIntoEpisodes(
  events: WorkflowEventLike[],
  options: { startedAt: Date | string; minEvents?: number }
): Promise<Episode[]> {
  const minEvents = options.minEvents ?? 4;
  if (events.length < minEvents) return [];

  const startMs = new Date(options.startedAt).getTime();
  const { text } = buildEventIndex(events, options.startedAt);

  const started = Date.now();
  const { content } = await createChatCompletion(
    "activity_interpretation",
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Session events (${events.length} total):\n\n${text}\n\nReturn the episodes as JSON.`,
      },
    ],
    { temperature: 0.2, maxTokens: 4000, responseFormat: { type: "json_object" } }
  );

  let parsed: any;
  try {
    parsed = unwrapObject(JSON.parse(content));
  } catch {
    logTs("episodes", "model returned unparseable JSON; no episodes produced");
    return [];
  }

  const raw = Array.isArray(parsed?.episodes) ? parsed.episodes : [];
  const episodes: Episode[] = [];

  for (const r of raw) {
    // Indices are the audit trail; an episode without valid ones cannot be
    // traced back to anything and is worse than no episode at all.
    const indices: number[] = Array.isArray(r?.eventIndices)
      ? r.eventIndices
          .map((n: unknown) => Number(n))
          .filter((n: number) => Number.isInteger(n) && n >= 0 && n < events.length)
      : [];
    if (indices.length === 0) continue;

    indices.sort((a, b) => a - b);
    const first = events[indices[0]];
    const last = events[indices[indices.length - 1]];
    episodes.push({
      index: episodes.length + 1,
      label: String(r.label || "untitled").slice(0, 120),
      summary: String(r.summary || "").slice(0, 1200),
      kind: normaliseKind(r.kind),
      startSeconds: Math.max(0, Math.round((new Date(first.at).getTime() - startMs) / 1000)),
      endSeconds: Math.max(0, Math.round((new Date(last.at).getTime() - startMs) / 1000)),
      evidenceIndices: indices,
    });
  }

  episodes.sort((a, b) => a.startSeconds - b.startSeconds);
  episodes.forEach((e, i) => (e.index = i + 1));

  logTs(
    "episodes",
    `${events.length} events → ${episodes.length} episodes (${Date.now() - started}ms)`
  );
  return episodes;
}

function normaliseKind(value: unknown): Episode["kind"] {
  const k = String(value || "").toLowerCase();
  const allowed: Episode["kind"][] = [
    "planning",
    "implementation",
    "debugging",
    "verification",
    "research",
    "review",
    "idle",
    "other",
  ];
  return (allowed as string[]).includes(k) ? (k as Episode["kind"]) : "other";
}
