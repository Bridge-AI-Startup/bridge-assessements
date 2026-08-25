/**
 * Companion director — the "thinking" half of the voice interviewer.
 *
 * A background loop (director.ts) calls this with everything known about a
 * live session: the activity timeline, the voice conversation so far, the
 * pending briefing, and recent briefing history. With no latency pressure and
 * a smart model, it decides whether there is ONE question worth asking right
 * now — and phrases it. The ElevenLabs voice agent never sees any of this
 * machinery; it just receives the finished question via a briefing-carrying
 * pulse and delivers it.
 *
 * Keep the interviewing intelligence HERE, not in the voice prompt: the voice
 * layer's job is delivery + reacting to candidate-initiated speech.
 */
import type { CompanionMessage } from "./transcript.js";

// Deliberately NOT imported from services/shorts/llmProxy.ts: that module's
// import chain reaches the Shorts Mongo connection, which throws without
// ATLAS_URI (breaking unit tests and coupling the companion to Shorts).
function getAnthropicApiKeyOrThrow(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server");
  }
  return key;
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DECISION_TIMEOUT_MS = 60_000;
const DEFAULT_DIRECTOR_MODEL = "claude-sonnet-5";
/**
 * Sonnet 5 runs adaptive thinking by default and thinking tokens bill against
 * max_tokens — at 700 the model burned the whole budget reasoning and emitted
 * zero JSON (stop_reason max_tokens, empty text; same failure the Bridge
 * Assistant hit at 1000). Budget must fit thinking + the small JSON decision.
 */
const MAX_DECISION_TOKENS = 4000;

export function getDirectorModel(): string {
  return process.env.COMPANION_DIRECTOR_MODEL?.trim() || DEFAULT_DIRECTOR_MODEL;
}

export interface DirectorDecision {
  shouldSpeak: boolean;
  question?: string;
  anchorSummary?: string;
  reason: string;
}

export interface BriefingLike {
  briefingId: string;
  question: string;
  anchorSummary?: string;
  reason?: string;
  createdAt?: Date | string;
  expiresAt?: Date | string;
  deliveredAt?: Date | string | null;
  outcome?: string;
}

export interface DirectorInput {
  /** JSON-safe context bundle sections (assessment/timeline/conversation). */
  contextBundle: unknown;
  /** Full voice transcript tail, chronological. */
  voiceTail: CompanionMessage[];
  pendingBriefing: BriefingLike | null;
  briefingHistory: BriefingLike[];
  elapsedMinutes: number | null;
  minutesSinceLastDelivered: number | null;
}

/**
 * The director prompt — deliberately purpose-first and minimal, at Saaz's
 * direction (2026-08-25): give the model who it is and why it's there, not a
 * rulebook. The old companion died by rule accretion; behavior rules get
 * added back here only when testing shows a specific hole.
 */
export const DIRECTOR_SYSTEM_PROMPT = `You are a pair-programming interviewer sitting in on a live coding assessment — the kind of colleague a curious senior engineer would be, watching a candidate build something with an AI assistant. You never speak directly: a voice agent sits with the candidate and delivers what you decide. Your whole job is to understand how this candidate thinks, and to draw that thinking out.

The employer reviewing this session can already see the code, the prompts, and a replay of everything that happened. The one thing they cannot see is the candidate's reasoning — why they broke the task down the way they did, what they chose to delegate, how they judged what the AI gave back, what they actually verified before calling it done. Your questions are the only way that reasoning gets captured.

You receive everything known about the session: the assessment, the activity timeline (entries are labeled by actor — "candidate" is what they typed or said themselves; "ai_assistant" is their AI working autonomously), the voice conversation so far (up to ~10 seconds stale), the question you currently have waiting to be delivered (if any), and the questions already asked. Decide what a great interviewer would do right now: ask about something specific that's happening, or let them work. Both are common — a real interviewer spends most of the session listening. Ask the way a real person would: short, spoken, about the thing you actually saw. Never steer, hint, or help with the task itself, and don't re-ask what they've already explained — you're there to understand, not influence.

Respond with ONLY a JSON object, no prose, no code fences:
{"shouldSpeak": boolean, "question": "the exact question, spoken register", "anchorSummary": "what prompted it, one short clause", "reason": "one line for the logs"}
When shouldSpeak is false, omit question/anchorSummary and give the reason. If your waiting question is still the right one, return it unchanged; return a different question to replace it; shouldSpeak false withdraws it.`;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function serializeBriefing(b: BriefingLike | null | undefined) {
  if (!b) return null;
  return {
    question: b.question,
    anchorSummary: b.anchorSummary || undefined,
    createdAt: b.createdAt || undefined,
    outcome: b.outcome || undefined,
    delivered: Boolean(b.deliveredAt),
  };
}

export function buildDirectorUserMessage(input: DirectorInput): string {
  const voice = input.voiceTail.slice(-40).map((m) => ({
    role: m.role,
    text: truncate(m.text, 400),
    at: new Date(m.timestampMs).toISOString(),
  }));
  const payload = {
    elapsedMinutes: input.elapsedMinutes,
    minutesSinceLastDeliveredQuestion: input.minutesSinceLastDelivered,
    pendingBriefing: serializeBriefing(input.pendingBriefing),
    briefingHistory: input.briefingHistory.map(serializeBriefing),
    voiceTranscript: voice,
    context: input.contextBundle,
  };
  return JSON.stringify(payload);
}

/** Strip code fences and grab the outermost JSON object. */
export function parseDirectorDecision(raw: string): DirectorDecision | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof obj.shouldSpeak !== "boolean") return null;
    const question =
      typeof obj.question === "string" && obj.question.trim()
        ? obj.question.trim()
        : undefined;
    if (obj.shouldSpeak && !question) return null;
    return {
      shouldSpeak: obj.shouldSpeak,
      question,
      anchorSummary:
        typeof obj.anchorSummary === "string" ? obj.anchorSummary : undefined,
      reason: typeof obj.reason === "string" ? obj.reason : "",
    };
  } catch {
    return null;
  }
}

/**
 * One decision call. Throws on transport/HTTP errors; returns null when the
 * model's reply is unparseable (caller logs and moves on — a briefing is never
 * worth retry loops).
 */
export async function callDirectorModel(
  input: DirectorInput
): Promise<DirectorDecision | null> {
  const apiKey = getAnthropicApiKeyOrThrow();
  const model = getDirectorModel();

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_DECISION_TOKENS,
      // Bounded judgment call on every tick — cap thinking depth so a
      // background loop doesn't pay research-grade reasoning 2x/minute.
      output_config: { effort: "medium" },
      // Stable prompt cached across every tick of every session; the volatile
      // bundle rides in the user message.
      system: [
        {
          type: "text",
          text: DIRECTOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildDirectorUserMessage(input) }],
    }),
    signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `director model HTTP ${response.status}: ${truncate(body, 300)}`
    );
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  const decision = parseDirectorDecision(text);
  if (!decision) {
    console.warn(
      `[companion-director] unparseable reply (${(data as any).stop_reason ?? "?"}): ${truncate(text, 400)}`
    );
  }
  return decision;
}
