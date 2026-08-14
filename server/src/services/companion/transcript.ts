/**
 * Shared reader for the in-session voice companion transcript.
 *
 * The overlay flushes messages every 10s as JSONL blobs under
 * `{proctoringSessionId}/companion/`. This is the one place that knows how to
 * reassemble them; the context center, the evaluation pipeline, and the
 * communication assessment all read through here so the storage layout has a
 * single consumer to change.
 */
import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "../capture/storage.js";

export interface CompanionMessage {
  /** "candidate"/"user" for the human; anything else is the companion agent. */
  role: string;
  text: string;
  timestampMs: number;
}

export function isCandidateRole(role: string): boolean {
  return role === "candidate" || role === "user";
}

/** Read and chronologically merge every companion JSONL blob for a session. */
export async function readCompanionMessages(
  proctoringSessionId: string
): Promise<CompanionMessage[]> {
  const storage = getFrameStorage();
  let keys: string[] = [];
  try {
    keys = await storage.listKeys(`${proctoringSessionId}/companion`);
  } catch {
    return [];
  }
  // Voice chunks and other artifacts may live under the same prefix.
  keys = keys.filter((k) => k.endsWith(".jsonl")).sort();

  const messages: CompanionMessage[] = [];
  for (const key of keys) {
    try {
      const content = await storage.getTranscript(key);
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (
            msg.role &&
            msg.text != null &&
            typeof msg.timestampMs === "number"
          ) {
            messages.push({
              role: msg.role,
              text: String(msg.text),
              timestampMs: msg.timestampMs,
            });
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // skip unreadable chunk
    }
  }
  messages.sort((a, b) => a.timestampMs - b.timestampMs);
  return messages;
}

/**
 * A companion message shaped like a workflow event, so the evaluation
 * timeline can merge voice chronologically with prompts/tools/screen events.
 * Matches `WorkflowEventLike` structurally (type/at/text/payload).
 */
export interface VoiceEventLike {
  type: "voice_utterance";
  at: Date;
  text: string;
  toolName?: null;
  payload: { source: "companion"; role: "candidate" | "agent" };
}

/** Resolve the proctoring session for a submission and return voice as events. */
export async function getVoiceEventsForSubmission(
  submissionId: string
): Promise<VoiceEventLike[]> {
  try {
    const proctoringSession = await ProctoringSessionModel.findOne({
      submissionId,
    })
      .select("_id")
      .lean();
    if (!proctoringSession) return [];
    const messages = await readCompanionMessages(String(proctoringSession._id));
    return messages
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({
        type: "voice_utterance" as const,
        at: new Date(m.timestampMs),
        text: m.text.trim(),
        toolName: null,
        payload: {
          source: "companion" as const,
          role: isCandidateRole(m.role) ? ("candidate" as const) : ("agent" as const),
        },
      }));
  } catch {
    // Voice is supplementary evidence — its absence must never block grading.
    return [];
  }
}
