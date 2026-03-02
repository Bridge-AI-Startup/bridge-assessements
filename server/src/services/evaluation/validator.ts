import { PROMPT_VALIDATE_CRITERION } from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { validationResultSchema } from "../schemas/evaluation.js";
import type { ValidationResult } from "../../types/evaluation.js";
import { unwrapObject } from "./llmJson.js";

/**
 * Validate whether a criterion is evaluable from a screen recording.
 * Returns valid: true if the criterion describes observable behavior,
 * or valid: false with a reason and reformulation suggestion if it does not.
 */
export async function validateCriterion(criterion: string): Promise<ValidationResult> {
  const messages = [
    { role: "system" as const, content: PROMPT_VALIDATE_CRITERION.system },
    {
      role: "user" as const,
      content: PROMPT_VALIDATE_CRITERION.userTemplate(criterion),
    },
  ];

  const { content } = await createChatCompletion(
    "criterion_validation",
    messages,
    {
      provider: PROMPT_VALIDATE_CRITERION.provider,
      model: PROMPT_VALIDATE_CRITERION.model,
      temperature: 0.1,
      responseFormat: { type: "json_object" },
    }
  );

  const parsed = validationResultSchema.parse(
    unwrapObject(JSON.parse(content))
  );

  return parsed;
}
