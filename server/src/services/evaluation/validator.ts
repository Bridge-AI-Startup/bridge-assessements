import {
  PROMPT_VALIDATE_CRITERION,
  type CriterionEvidenceProfile,
} from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { validationResultSchema } from "../schemas/evaluation.js";
import type { ValidationResult } from "../../types/evaluation.js";
import { unwrapObject } from "./llmJson.js";

/**
 * Validate whether a criterion can be scored from the record we actually collect.
 * Returns valid: true if the behaviour leaves a trace in that record, or
 * valid: false with the missing evidence and a reformulation suggestion.
 *
 * The profile matters: the hook stream and a screen recording capture close to
 * opposite things, so the same criterion can be scoreable under one and pure
 * guesswork under the other.
 */
export async function validateCriterion(
  criterion: string,
  profile: CriterionEvidenceProfile = "workflow"
): Promise<ValidationResult> {
  const messages = [
    { role: "system" as const, content: PROMPT_VALIDATE_CRITERION.system(profile) },
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
