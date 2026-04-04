import { PROMPT_TRANSCRIPT_SESSION_SUMMARY } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import type { TranscriptEvent } from "../../types/evaluation.js";

/**
 * Generate a high-level narrative summary of a candidate's screen recording session.
 * Used as the session_summary field in the evaluation report.
 */
export async function generateSessionSummary(
  transcript: TranscriptEvent[]
): Promise<string> {
  const transcriptJson = JSON.stringify(transcript, null, 2);

  const messages = [
    { role: "system" as const, content: PROMPT_TRANSCRIPT_SESSION_SUMMARY.system },
    {
      role: "user" as const,
      content: PROMPT_TRANSCRIPT_SESSION_SUMMARY.userTemplate(transcriptJson),
    },
  ];

  const { content } = await createChatCompletion(
    "transcript_evaluation",
    messages,
    {
      provider: PROMPT_TRANSCRIPT_SESSION_SUMMARY.provider,
      model: PROMPT_TRANSCRIPT_SESSION_SUMMARY.model,
      temperature: 0.2,
    }
  );

  return content.trim();
}
