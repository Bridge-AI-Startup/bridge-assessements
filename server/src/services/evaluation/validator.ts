import {
  PROMPT_VALIDATE_CRITERION,
  type CriterionEvidenceProfile,
} from "../../prompts/index.js";
import { createChatCompletion } from "../langchainAI.js";
import { validationResultSchema } from "../schemas/evaluation.js";
import type { ValidationResult } from "../../types/evaluation.js";
import { unwrapObject } from "./llmJson.js";
import AssessmentModel from "../../models/assessment.js";

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

/** A persisted evaluability verdict for one criterion under one profile. */
export interface StoredCriterionValidation {
  criterion: string;
  profile: CriterionEvidenceProfile;
  valid: boolean;
  reason?: string | null;
  validatedAt: Date;
}

/**
 * Return one validation per criterion, in order, reusing verdicts persisted on
 * the assessment and validating (then persisting) only criteria that have no
 * stored entry for this profile. Lookup is by exact criterion text, so editing
 * a criterion re-validates it and stale entries for deleted criteria are
 * simply never matched again.
 *
 * This exists so evaluability is decided once per criterion, not once per
 * candidate: the per-run LLM check was a coin flip on borderline wording, and
 * the same criterion could be graded for one candidate and refused for the
 * next. A validator failure fails open (valid: true, nothing persisted) —
 * refusing to grade an employer's criterion needs an explicit verdict, never
 * an error path.
 */
export async function ensureCriteriaValidations(
  assessmentId: string,
  criteria: string[],
  profile: CriterionEvidenceProfile = "workflow"
): Promise<ValidationResult[]> {
  let stored: StoredCriterionValidation[] = [];
  try {
    const doc: any = await AssessmentModel.findById(assessmentId)
      .select("evaluationCriteriaValidations")
      .lean();
    if (Array.isArray(doc?.evaluationCriteriaValidations)) {
      stored = doc.evaluationCriteriaValidations;
    }
  } catch {
    // Missing assessment (direct-transcript runs) → validate fresh below.
  }

  const results: ValidationResult[] = [];
  const fresh: StoredCriterionValidation[] = [];
  for (const criterion of criteria) {
    const hit = stored.find(
      (v) => v?.criterion === criterion && v?.profile === profile
    );
    if (hit) {
      results.push({ valid: hit.valid, reason: hit.reason ?? undefined });
      continue;
    }
    let verdict: ValidationResult;
    try {
      verdict = await validateCriterion(criterion, profile);
    } catch (err) {
      console.error(
        `[criteria-validation] validator failed for "${criterion}"; grading it anyway:`,
        err
      );
      results.push({ valid: true });
      continue;
    }
    results.push(verdict);
    fresh.push({
      criterion,
      profile,
      valid: verdict.valid,
      reason: verdict.reason ?? null,
      validatedAt: new Date(),
    });
  }

  if (fresh.length > 0) {
    try {
      await AssessmentModel.findByIdAndUpdate(assessmentId, {
        $set: { evaluationCriteriaValidations: [...stored, ...fresh] },
      });
    } catch (err) {
      console.error(
        "[criteria-validation] persisting validations failed (will re-validate next run):",
        err
      );
    }
  }

  return results;
}
