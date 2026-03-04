/**
 * LLM-as-judge: automated quality scoring of enriched transcript output.
 * Scores on accuracy, specificity, and behavioral insight (1-5 each).
 */

import { jsonrepair } from "jsonrepair";
import { PROMPT_LLM_JUDGE } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { llmJudgeScoreSchema, type LlmJudgeScoreSchema } from "../schemas/evaluation.js";
import type { ScreenMoment, EnrichedTranscript } from "../../types/evaluation.js";

/**
 * Score an enriched transcript against its raw input moments.
 */
export async function judgeEnrichedTranscript(
  moments: ScreenMoment[],
  enriched: EnrichedTranscript
): Promise<LlmJudgeScoreSchema> {
  const rawInput = formatMomentsForJudge(moments);
  const enrichedOutput = formatEnrichedForJudge(enriched);

  const messages = [
    { role: "system" as const, content: PROMPT_LLM_JUDGE.system },
    {
      role: "user" as const,
      content: PROMPT_LLM_JUDGE.userTemplate(rawInput, enrichedOutput),
    },
  ];

  const { content } = await createChatCompletion("activity_interpretation", messages, {
    provider: PROMPT_LLM_JUDGE.provider,
    model: PROMPT_LLM_JUDGE.model,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(jsonrepair(content));
    return llmJudgeScoreSchema.parse(parsed);
  } catch {
    return {
      accuracy: 1,
      specificity: 1,
      behavioral_insight: 1,
      justification: "Failed to parse judge response",
    };
  }
}

function formatMomentsForJudge(moments: ScreenMoment[]): string {
  return moments
    .map((m, i) => {
      const regions = m.regions
        .map((r) => `  [${r.region}] ${r.text_content.slice(0, 200)}`)
        .join("\n");
      return `Moment ${i} (${m.ts}):\n${regions}`;
    })
    .join("\n\n");
}

function formatEnrichedForJudge(enriched: EnrichedTranscript): string {
  const events = enriched.events
    .map(
      (e, i) =>
        `Event ${i} (${e.ts}s - ${e.ts_end}s) [${e.intent}]:\n  ${e.behavioral_summary}`
    )
    .join("\n\n");

  return `SESSION NARRATIVE:\n${enriched.session_narrative}\n\nENRICHED EVENTS:\n${events}`;
}
