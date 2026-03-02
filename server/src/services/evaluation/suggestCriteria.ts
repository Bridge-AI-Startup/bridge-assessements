import { z } from "zod";
import { PROMPT_SUGGEST_CRITERIA } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { unwrapObject } from "./llmJson.js";

/**
 * Suggest 8–12 observable evaluation criteria for a given job description.
 * Uses a higher temperature (0.7) to produce varied, creative suggestions.
 */
export async function suggestCriteria(
  jobDescription: string
): Promise<string[]> {
  const messages = [
    { role: "system" as const, content: PROMPT_SUGGEST_CRITERIA.system },
    {
      role: "user" as const,
      content: PROMPT_SUGGEST_CRITERIA.userTemplate(jobDescription),
    },
  ];

  const { content } = await createChatCompletion(
    "suggest_criteria",
    messages,
    {
      provider: PROMPT_SUGGEST_CRITERIA.provider,
      model: PROMPT_SUGGEST_CRITERIA.model,
      temperature: 0.7,
      responseFormat: { type: "json_object" },
    }
  );

  const parsed = z
    .object({ criteria: z.array(z.string()) })
    .parse(unwrapObject(JSON.parse(content)));

  return parsed.criteria;
}
