import { jsonrepair } from "jsonrepair";
import { PROMPT_EVALUATE_CRITERION } from "../../prompts/index.js";
import { unwrapObject } from "./llmJson.js";
import { createChatCompletion } from "../langchainAI.js";
import { criterionResultSchema } from "../schemas/evaluation.js";
import type {
  TranscriptEvent,
  CriterionResult,
  GroundedCriterion,
} from "../../types/evaluation.js";

/** True if the result is based on observable evidence; false when the model effectively said "not evaluable". */
function isEvaluable(parsed: {
  evidence: unknown[];
  verdict: string;
}): boolean {
  if (parsed.evidence.length > 0) return true;
  const v = parsed.verdict.toLowerCase();
  return !(
    /not evaluable|cannot be (directly )?observed|not observable/.test(v) ||
    v.includes("cannot be directly observed")
  );
}

/**
 * Parse LLM JSON robustly. We currently:
 * 1. Extract the first {...} (in case of markdown or extra text).
 * 2. Try jsonrepair then parse first (fixes unescaped quotes in strings,
 *    trailing commas, newlines inside strings, etc.); then try raw JSON.parse.
 * 3. On failure, throw with a short raw snippet for debugging.
 */
function parseEvaluatorJson(jsonStr: string): unknown {
  const trimmed = jsonStr.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  const extracted = match ? match[0] : trimmed;

  try {
    return JSON.parse(jsonrepair(extracted));
  } catch {
    try {
      return JSON.parse(extracted);
    } catch (e) {
      const snippet =
        extracted.slice(0, 600) + (extracted.length > 600 ? "…" : "");
      throw new Error(
        `Evaluator JSON parse failed: ${e instanceof Error ? e.message : e}. Raw snippet: ${snippet}`,
      );
    }
  }
}

/**
 * Evaluate a single criterion against a transcript (raw criterion + full transcript).
 * Used by runEvals and for backward compatibility. Evidence is found first, score last.
 */
export async function evaluateCriterion(
  criterion: string,
  transcript: TranscriptEvent[],
): Promise<CriterionResult> {
  const transcriptJson = JSON.stringify(transcript, null, 2);

  const messages = [
    { role: "system" as const, content: PROMPT_EVALUATE_CRITERION.system },
    {
      role: "user" as const,
      content: PROMPT_EVALUATE_CRITERION.userTemplate(
        criterion,
        transcriptJson,
      ),
    },
  ];

  const { content } = await createChatCompletion(
    "transcript_evaluation",
    messages,
    {
      provider: PROMPT_EVALUATE_CRITERION.provider,
      model: PROMPT_EVALUATE_CRITERION.model,
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: { type: "json_object" },
    },
  );

  const parsed = criterionResultSchema.parse(
    unwrapObject(parseEvaluatorJson(content)),
  );

  return {
    ...parsed,
    criterion,
    evaluable: isEvaluable(parsed),
  };
}

/**
 * Evaluate a single criterion using a grounded definition and filtered transcript.
 * Used by the orchestrator. Builds the user message from definition and
 * positive/negative indicators for higher-quality scoring.
 */
export async function evaluateCriterionWithGrounding(
  grounded: GroundedCriterion,
  filteredTranscript: TranscriptEvent[],
  originalCriterion: string,
): Promise<CriterionResult> {
  const transcriptJson = JSON.stringify(filteredTranscript, null, 2);
  const escapedCriterion = originalCriterion.replace(/"/g, '\\"');

  const userContent = `CRITERION: ${originalCriterion}

DEFINITION: ${grounded.definition}

POSITIVE INDICATORS (behaviors that support a high score):
${grounded.positive_indicators.map((p) => `- ${p}`).join("\n")}

NEGATIVE INDICATORS (behaviors that support a low score):
${grounded.negative_indicators.map((n) => `- ${n}`).join("\n")}

TRANSCRIPT:
${transcriptJson}

Evaluate the candidate on this criterion using the definition and indicators above. Remember: collect evidence from the transcript first, then assign a score and confidence based on what you found.

Respond with a JSON object with exactly these fields:
{
  "criterion": "${escapedCriterion}",
  "evidence": [{ "ts": number, "ts_end": number, "observation": string }],
  "score": number (1-10),
  "confidence": "high" | "medium" | "low",
  "verdict": string (one paragraph summary)
}

In all string fields (criterion, observation, verdict), escape any double quotes inside the string with backslash (e.g. \\"). When citing code or test cases, you may use single quotes instead to avoid escaping.`;

  const messages = [
    { role: "system" as const, content: PROMPT_EVALUATE_CRITERION.system },
    { role: "user" as const, content: userContent },
  ];

  const { content } = await createChatCompletion(
    "transcript_evaluation",
    messages,
    {
      provider: PROMPT_EVALUATE_CRITERION.provider,
      model: PROMPT_EVALUATE_CRITERION.model,
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: { type: "json_object" },
    },
  );

  const parsed = criterionResultSchema.parse(
    unwrapObject(parseEvaluatorJson(content)),
  );

  return {
    ...parsed,
    criterion: originalCriterion,
    evaluable: isEvaluable(parsed),
  };
}
