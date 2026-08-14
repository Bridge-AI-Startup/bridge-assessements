import { z } from "zod";
import {
  PROMPT_SUGGEST_CRITERIA,
  type CriterionEvidenceProfile,
} from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { unwrapObject } from "./llmJson.js";
import { validateCriterion } from "./validator.js";

/**
 * Suggest up to 5 evaluation criteria for a given job description, scoreable
 * from the record the given evidence profile actually collects.
 *
 * Uses a higher temperature (0.7) for varied suggestions, then runs each one
 * back through the validator under the same profile — the generator will still
 * occasionally propose a behaviour nothing records, and that second pass is what
 * keeps it out of the employer's rubric.
 */
export async function suggestCriteria(
  jobDescription: string,
  profile: CriterionEvidenceProfile = "workflow"
): Promise<string[]> {
  const messages = [
    { role: "system" as const, content: PROMPT_SUGGEST_CRITERIA.system(profile) },
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

  const suggested = parsed.criteria
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);

  const validationResults = await Promise.all(
    suggested.map(async (criterion) => {
      try {
        return await validateCriterion(criterion, profile);
      } catch {
        return { valid: false as const, reason: "Validation failed" };
      }
    })
  );

  return suggested.filter((_, i) => validationResults[i].valid).slice(0, 5);
}
