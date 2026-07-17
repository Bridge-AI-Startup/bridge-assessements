import { z } from "zod";
import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "../langchainAI.js";
import type { JudgeArtifacts } from "./artifacts.js";

/** Stored cap; longer model output is truncated so grading does not fail Zod validation. */
export const MAX_BEHAVIORAL_CITATIONS = 40;
export const MAX_BEHAVIORAL_CITATION_CHARS = 800;

/** Truncate citation strings before Zod max() — agents often paste whole curl/file output. */
export function normalizeBehavioralCitations(val: unknown): unknown {
  if (!Array.isArray(val)) return val;
  return val.slice(0, MAX_BEHAVIORAL_CITATIONS).map((item) => {
    const s = typeof item === "string" ? item : String(item ?? "");
    const trimmed = s.trim();
    if (trimmed.length <= MAX_BEHAVIORAL_CITATION_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_BEHAVIORAL_CITATION_CHARS - 1)}…`;
  });
}

export const behavioralCitationsFieldSchema = z.preprocess(
  normalizeBehavioralCitations,
  z.array(z.string().max(MAX_BEHAVIORAL_CITATION_CHARS)).max(MAX_BEHAVIORAL_CITATIONS)
);

export const behavioralJudgeResultSchema = z.object({
  verdict: z.enum(["pass", "fail", "inconclusive"]),
  rationale: z.string().max(2500),
  citations: behavioralCitationsFieldSchema,
});

export type BehavioralJudgeResult = z.infer<typeof behavioralJudgeResultSchema>;

/** Derived in the orchestrator so the agent knows whether “runtime” proof is possible. */
export type BehavioralRuntimeHints = {
  /** In-sandbox origin discovered for curl (http://127.0.0.1:PORT). */
  baseUrlAvailable: boolean;
  /** At least one runbook shell step exited non-zero (install/start may be broken). */
  anyRunbookCommandFailed: boolean;
  /** Initial GET to base URL in artifact collection succeeded (not connection error). */
  httpSeedFetchOk: boolean;
};

export type BehavioralJudgeInput = {
  assessmentTitle: string;
  assessmentDescription: string;
  behavioralCheck: string;
  executionProfile: "cli_stdout" | "web_server" | "unclear";
  readmeExcerpt: string;
  artifacts: JudgeArtifacts;
  runtimeHints?: BehavioralRuntimeHints;
};

/** Shared seed context for one-shot judge and tool agent first message */
export function buildJudgeEvidencePayload(input: BehavioralJudgeInput): string {
  const a = input.artifacts;
  return `Assessment title: ${input.assessmentTitle}

Assessment description (employer contract):
${input.assessmentDescription}

Behavioral check to evaluate (one sentence):
${input.behavioralCheck}

Execution profile: ${input.executionProfile}

README excerpt:
${input.readmeExcerpt.slice(0, 6000)}

--- Repository layout (actual clone under repo root — verify before cd; README paths may be wrong) ---
${input.artifacts.repoLayoutExcerpt || "(not available)"}

--- Entry command (already executed in sandbox) ---
${a.entryCommand}

--- stdout (truncated) ---
${a.stdout || "(empty)"}

--- stderr (truncated) ---
${a.stderr || "(empty)"}

--- Main source file: ${a.mainSourcePath} (truncated) ---
${a.mainSourceExcerpt}

--- HTTP response body from base URL (if any, truncated) ---
${a.httpBodyExcerpt || "(none — CLI or no server)"}
${formatRuntimeHintsSection(input.runtimeHints)}
`;
}

function formatRuntimeHintsSection(
  hints: BehavioralRuntimeHints | undefined
): string {
  if (!hints) {
    return `
--- Grading runtime (automated) ---
(no runtime hints — treat HTTP/API checks cautiously; prefer inconclusive if only static files were read)`;
  }
  const { baseUrlAvailable, anyRunbookCommandFailed, httpSeedFetchOk } = hints;
  return `
--- Grading runtime (automated — use for honesty) ---
- In-sandbox app origin available for curl (127.0.0.1): ${baseUrlAvailable ? "yes" : "NO"}
- README runbook had a failed shell step: ${anyRunbookCommandFailed ? "YES (install/start may be broken)" : "no"}
- Warmup in-sandbox GET to app: ${!baseUrlAvailable ? "skipped (no origin)" : httpSeedFetchOk ? "succeeded" : "FAILED or empty — probe with run_command curl before pass"}
- Candidate test suites: not used (use curl + read_file only)
`;
}

/**
 * One-shot judge (kept for completeness/possible future use).
 * The product path uses the tool-using agent judge by default.
 */
export async function judgeBehavioralCheck(
  input: BehavioralJudgeInput
): Promise<BehavioralJudgeResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You evaluate ONE behavioral requirement for a candidate take-home submission.

You are given the employer's assignment text, one behavioral check sentence, and captured evidence:
- stdout/stderr from running the candidate's entry command
- an excerpt of their main source file
- optional HTTP page body if a server URL was available

Your job:
- Decide whether the submission satisfies THIS behavioral check in the context of the assignment.
- Do NOT require exact variable names or labels in stdout unless the assignment explicitly demands specific strings.
- Readable labels (e.g. "Item:" vs "food_item") satisfy "clear output" style requirements.
- For edge cases (empty list, invalid rows): if the assignment requires handling them, look for logic in source OR observable behavior in stdout from the provided run. If the default run does not exercise that path and source is silent, you may say inconclusive only if **some** relevant code exists; if the needed code cannot be found at all, **fail**.
- Contract vs cosmetics: the assessment description is the contract. If it states concrete rules (numeric thresholds, discount conditions, required formulas), compare them to source and stdout.
- Contradiction sweep (mandatory): Extract any numeric or business rules from the assessment description (e.g. "discount when order total exceeds $50"). If stdout or source shows a different rule in plain text (e.g. a constant DISCOUNT_THRESHOLD = 20, or a printed line like "10% off orders over $20" when the assignment said $50), that is a contract violation. In that case you must fail not only explicit discount threshold checks, but also any check whose natural reading depends on the program behaving correctly or as specified, including: "correctly" / "as required" / "when applicable"; loops or calculations that "correctly" apply discounts or totals; "includes … discount" or "any discount applied" (the shown discount must match the assignment, not merely exist); "clearly formatted" if the check mentions discount; and behavioral check sentences that bundle multiple requirements when any bundled part fails the contract.
- When there is no contradiction: If THIS check asks only for presence of generic labels (item, quantity, price) with no mention of discount, correctness, or "as required", you may pass on presence alone.
- "pass" = evidence clearly supports that the requirement is met.
- "fail" = evidence shows it is not met, OR **no relevant source can be found** in the excerpts to implement the check (treat missing implementation as not met).
- "inconclusive" = relevant code **is** present in the excerpts but the outcome is **ambiguous**, or output is **truncated** in a way that blocks a fair call — **not** for “file not found” (use **fail**).

citations: short verbatim quotes from stdout or source (or HTTP body) supporting your verdict.`,
    },
    { role: "user", content: buildJudgeEvidencePayload(input) },
  ];

  const { result } = await createChatCompletionWithStructuredOutput(
    "workflow_evaluation",
    messages,
    behavioralJudgeResultSchema,
    {
      temperature: 0,
      maxTokens: 2500,
    }
  );

  return result;
}

