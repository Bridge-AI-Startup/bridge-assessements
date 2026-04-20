import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "../langchainAI.js";
import { runbookPlanSchema, type RunbookPlan } from "./schema.js";

export type RunbookPlanningInput = {
  readmeText: string;
  repoSummary: string;
  /**
   * Live `ls`/`find` from the grading sandbox. The model should prefer this over README
   * path examples when they disagree.
   */
  repoLayoutProbe?: string;
};

function buildRunbookUserMessage(input: RunbookPlanningInput): string {
  const layout = input.repoLayoutProbe?.trim();
  const layoutBlock = layout
    ? `Sandbox layout (actual filesystem in the grading environment — use this to choose cwd and cd paths):\n${layout}\n\n`
    : "";
  return `Repo summary:\n${input.repoSummary}\n\n${layoutBlock}README:\n${input.readmeText}`;
}

export async function extractRunbook(
  input: RunbookPlanningInput
): Promise<RunbookPlan> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You convert a README into a runnable command plan.

You MUST set executionProfile:
- cli_stdout: README runs a script/binary that prints results and exits (python main.py, node index.js batch job). No "listen", "server", "localhost:PORT", "uvicorn", "flask run", "npm run dev" for a live site.
- web_server: README starts a long-lived HTTP service on a port.
- unclear: not enough information.

Rules:
- Return only commands needed for setup/install/test/start.
- Prefer commands explicitly present in README with origin="readme".
- You may infer missing commands from repo summary with origin="inferred".
- Keep commands shell-ready and short.
- If cwd is omitted, execution defaults to repo root.
- When a "Sandbox layout" section is present, treat it as ground truth: every \`cwd\` and path in \`cd\` must match directories/files shown there. README examples often assume an extra parent folder; ignore that if the layout does not show it.
- If there is no layout section, assume the grader's cwd is already the project root; do not invent a parent folder unless it appears in the repo.
- Never output placeholder paths like "/path/to/repo", "<repo>", or "repo" as cwd.
- Only set cwd when a real subdirectory from the project is required.
- Max 12 total steps.
- Mark readmeCoverage booleans honestly.
- portsHint: ONLY when the README describes a long-running HTTP server listening on a port (e.g. "npm start", "uvicorn", "flask run", "python -m http.server"). For one-shot CLI scripts (python script.py, node cli.js that exits), use portsHint=[] (empty). Never guess 3000/8080 for a batch/CLI program.
- Prefer \`. ./venv/bin/activate\` over \`source\` for venvs (portable); commands run in bash.`,
    },
    {
      role: "user",
      content: buildRunbookUserMessage(input),
    },
  ];

  const { result } = await createChatCompletionWithStructuredOutput(
    "workflow_evaluation",
    messages,
    runbookPlanSchema,
    {
      temperature: 0,
      maxTokens: 1800,
    }
  );

  return result;
}
