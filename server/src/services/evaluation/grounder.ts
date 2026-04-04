import { PROMPT_GROUND_CRITERION } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { groundedCriterionSchema } from "../schemas/evaluation.js";
import type { GroundedCriterion } from "../../types/evaluation.js";
import { unwrapObject } from "./llmJson.js";

/**
 * Ground a single hiring criterion into a structured, observable definition.
 * Takes a raw criterion string and returns a GroundedCriterion with a clear
 * definition, positive/negative indicators, and relevant action types.
 */
export async function groundCriterion(criterion: string): Promise<GroundedCriterion> {
  const messages = [
    { role: "system" as const, content: PROMPT_GROUND_CRITERION.system },
    {
      role: "user" as const,
      content: PROMPT_GROUND_CRITERION.userTemplate(criterion),
    },
  ];

  const { content } = await createChatCompletion(
    "criterion_grounding",
    messages,
    {
      provider: PROMPT_GROUND_CRITERION.provider,
      model: PROMPT_GROUND_CRITERION.model,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    }
  );

  const parsed = groundedCriterionSchema.parse(
    unwrapObject(JSON.parse(content))
  );

  return {
    ...parsed,
    original: criterion,
  };
}
