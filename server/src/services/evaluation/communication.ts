/**
 * Communication assessment: how well the candidate explained what they were
 * doing, judged from what they said aloud to the in-session voice companion —
 * cross-checked against what the captured timeline shows they actually did.
 *
 * Two deliberate design rules:
 *
 * 1. SUPPLEMENTARY, never part of the combined score. Narration volume mostly
 *    measures comfort talking to a bot — non-native speakers and silent
 *    thinkers would be penalised for temperament, not skill. The employer sees
 *    this beside the score, not inside it.
 *
 * 2. Claims are verified, not taken at face value. The one thing holding both
 *    the voice stream and the activity stream buys us is falsifiability:
 *    "I tested it" with zero test runs in the timeline is a finding no single
 *    stream could produce. Every claim check cites the utterance it came from,
 *    and citations are validated like any other evidence.
 */
import { createChatCompletion } from "../langchainAI.js";
import { compactTranscriptForPrompt } from "./compactTranscript.js";
import type { TranscriptEvent } from "../../types/evaluation.js";

export interface ClaimCheck {
  /** What the candidate asserted, paraphrased tightly. */
  claim: string;
  /** ts (seconds) of the utterance the claim came from. */
  ts: number;
  verdict: "supported" | "contradicted" | "unverifiable";
  /** One sentence pointing at the timeline evidence (or its absence). */
  note: string;
}

export interface CommunicationAssessment {
  available: boolean;
  reason?: string;
  utteranceCount: number;
  wordCount: number;
  /** 1-10. Clarity and specificity of what WAS said — never volume of speech. */
  clarity: number | null;
  summary: string | null;
  /** Verbatim-ish moments worth an employer's attention, with timestamps. */
  highlights: Array<{ ts: number; quote: string; whyItMatters: string }>;
  claimChecks: ClaimCheck[];
}

/** Below this there is nothing to judge — report that rather than a hollow score. */
const MIN_UTTERANCES = 3;
const MIN_WORDS = 25;

const SYSTEM_PROMPT = `You assess how well a coding-assessment candidate communicated their thinking, using (a) a transcript of what they said aloud while working and (b) the captured timeline of what they actually did.

Judge ONLY what was said. Never penalise how little was said — sparse narration is temperament, not a skill deficit. If someone spoke rarely but clearly, that is high clarity.

Return a JSON object:
{
  "clarity": 1-10,            // specificity and coherence of what was said: naming intent, constraints, trade-offs = high; vague filler = low
  "summary": string,          // 2-3 sentences an employer can read: what their spoken reasoning reveals about how they think
  "highlights": [{ "ts": number, "quote": string, "whyItMatters": string }],   // up to 4, ts from the transcript
  "claimChecks": [{ "claim": string, "ts": number, "verdict": "supported"|"contradicted"|"unverifiable", "note": string }]
}

claimChecks: extract every FALSIFIABLE assertion the candidate made about their own actions or the state of the work ("I tested it", "I'll add validation first", "it works now", "I read through the starter code") and check it against the timeline. supported = the timeline shows it happened; contradicted = the timeline shows otherwise (say what it shows); unverifiable = the timeline cannot settle it. An announced intention counts as supported if the matching action appears later in the timeline. Statements of feeling or preference are not claims — skip them.

Be precise and neutral. A contradicted claim is a fact to report, not an accusation to prosecute.`;

/**
 * Events the model reads: every spoken line, plus the activity around them.
 *
 * Compacted for the same reason the rubric evaluator is: a tool-heavy 90-minute
 * session renders to ~160k tokens of timeline, which overflows the context
 * window outright, and a single verbose tool result can carry 20k characters on
 * its own. Uncompacted, this failed on exactly the long sessions where spoken
 * reasoning is most worth reading — and because the whole assessment is
 * fail-soft, it failed invisibly.
 *
 * Safe for this use: `speaking` is a HIGH_SIGNAL type, so downsampling drops
 * low-signal activity around the speech and never the utterances themselves.
 * The utterance/word counts and citation checks are computed from the full
 * timeline above, so compaction cannot move them either.
 */
function renderContext(timeline: TranscriptEvent[]): string {
  return compactTranscriptForPrompt(timeline)
    .map((e) => `[${e.ts.toFixed(0)}s-${e.ts_end.toFixed(0)}s] (${e.action_type}) ${e.description}`)
    .join("\n");
}

/**
 * Assess communication from a merged timeline (voice already interleaved).
 * Fail-soft: any model or parse failure yields available:false, never a throw —
 * this must not be able to break grading.
 */
export async function assessCommunication(
  timeline: TranscriptEvent[]
): Promise<CommunicationAssessment> {
  const spoken = timeline.filter(
    (e) => e.action_type === "speaking" && e.description.startsWith("Candidate")
  );
  // Count the candidate's words, not the renderer's framing around them.
  const quoteOf = (d: string) => d.match(/"([^]*)"\s*$/)?.[1] ?? d;
  const wordCount = spoken.reduce(
    (n, e) => n + quoteOf(e.description).trim().split(/\s+/).filter(Boolean).length,
    0
  );
  const base = {
    utteranceCount: spoken.length,
    wordCount,
    clarity: null,
    summary: null,
    highlights: [],
    claimChecks: [],
  };

  if (spoken.length < MIN_UTTERANCES || wordCount < MIN_WORDS) {
    return {
      available: false,
      reason: `too_little_speech_to_assess (${spoken.length} utterances, ~${wordCount} words)`,
      ...base,
    };
  }

  try {
    const { content } = await createChatCompletion(
      "activity_interpretation",
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Timeline (speech lines start "Candidate said aloud"; everything else is captured activity):\n\n${renderContext(
            timeline
          )}\n\nReturn the assessment as JSON.`,
        },
      ],
      { temperature: 0.2, maxTokens: 2000, responseFormat: { type: "json_object" } }
    );
    const parsed = JSON.parse(content);

    // Citations must point at real spoken moments — a judge inventing a
    // timestamp is exactly what the evidence validator exists to stop.
    const spokenTs = spoken.map((e) => e.ts);
    const near = (ts: unknown) =>
      typeof ts === "number" && spokenTs.some((s) => Math.abs(s - ts) <= 30);

    const highlights = (Array.isArray(parsed.highlights) ? parsed.highlights : [])
      .filter((h: any) => near(h?.ts) && typeof h?.quote === "string")
      .slice(0, 4)
      .map((h: any) => ({
        ts: h.ts,
        quote: String(h.quote).slice(0, 300),
        whyItMatters: String(h.whyItMatters || "").slice(0, 300),
      }));
    const claimChecks = (Array.isArray(parsed.claimChecks) ? parsed.claimChecks : [])
      .filter(
        (c: any) =>
          near(c?.ts) &&
          typeof c?.claim === "string" &&
          ["supported", "contradicted", "unverifiable"].includes(c?.verdict)
      )
      .slice(0, 10)
      .map((c: any) => ({
        claim: String(c.claim).slice(0, 300),
        ts: c.ts,
        verdict: c.verdict,
        note: String(c.note || "").slice(0, 400),
      }));

    const clarity = Number(parsed.clarity);
    return {
      available: true,
      utteranceCount: spoken.length,
      wordCount,
      clarity: Number.isFinite(clarity)
        ? Math.min(10, Math.max(1, Math.round(clarity)))
        : null,
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary.slice(0, 1000)
          : null,
      highlights,
      claimChecks,
    };
  } catch (err) {
    return {
      available: false,
      reason: `assessment_failed: ${(err as Error).message?.slice(0, 200)}`,
      ...base,
    };
  }
}
