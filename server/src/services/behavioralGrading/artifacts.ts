import type { Sandbox } from "e2b";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import type { RunbookPlan } from "./schema.js";

const MAX_STDOUT = 14_000;
const MAX_STDERR = 6_000;
const MAX_SOURCE = 18_000;
const MAX_HTTP = 10_000;
const MAX_REPO_LAYOUT = 10_000;

/** Run via bash so `source` and typical README commands work. */
export function bashLc(cmd: string): string {
  const escaped = cmd.replace(/'/g, "'\\''");
  return `bash -lc '${escaped}'`;
}

export function inferEntryCommand(runbook: RunbookPlan): string | null {
  const start = runbook.steps.find((s) => s.purpose === "start");
  if (start?.command?.trim()) return start.command.trim();
  const py = runbook.steps.find((s) => /\.py(\s|$)/.test(s.command));
  if (py?.command?.trim()) return py.command.trim();
  const node = runbook.steps.find((s) => /node\s/.test(s.command));
  if (node?.command?.trim()) return node.command.trim();
  return runbook.steps[0]?.command?.trim() ?? null;
}

export type JudgeArtifacts = {
  entryCommand: string;
  stdout: string;
  stderr: string;
  mainSourcePath: string;
  mainSourceExcerpt: string;
  httpBodyExcerpt: string;
  /** Actual paths in the clone — README may say e.g. test2/backend but repo may differ. */
  repoLayoutExcerpt: string;
};

/** Commands that typically block (dev server). Runbook already started these in the background when portsHint is set. */
function isLongRunningDevServerCommand(cmd: string): boolean {
  return /npm\s+(start|run\s+dev)|pnpm\s+dev|yarn\s+(dev|start)|vite|webpack-dev-server|next\s+dev|react-scripts\s+start|uvicorn|flask\s+run|python\s+-m\s+http\.server|rails\s+s|bin\/dev/i.test(
    cmd
  );
}

/**
 * Run the inferred entry command once (CLI) and read the main source file for LLM review.
 * For web apps: README runbook already started the server in the sandbox; we use the public
 * sandbox URL (not literal localhost) — see baseUrl fetch below. We avoid re-running `npm start`
 * which would block or fight for the port.
 */
export async function collectJudgeArtifacts(
  ctx: GradingSandboxContext,
  repoPath: string,
  runbook: RunbookPlan,
  baseUrl: string | undefined,
  sandbox: Sandbox
): Promise<JudgeArtifacts> {
  let repoLayoutExcerpt = "";
  try {
    const layoutProbe = await ctx.run(
      bashLc(
        `echo "== find . (maxdepth 4) ==" && find . -maxdepth 4 2>/dev/null | sort | head -450 && echo "" && echo "== package.json ==" && find . -name package.json -maxdepth 10 2>/dev/null | head -40`
      ),
      { cwd: repoPath, timeoutMs: 45_000 }
    );
    const combined = `${layoutProbe.stdout || ""}${
      layoutProbe.stderr ? `\n[stderr]\n${layoutProbe.stderr}` : ""
    }`;
    repoLayoutExcerpt =
      combined.length <= MAX_REPO_LAYOUT
        ? combined
        : `${combined.slice(0, MAX_REPO_LAYOUT)}\n… (truncated)`;
  } catch {
    repoLayoutExcerpt = "(could not list repository layout)";
  }

  const entryCommand = inferEntryCommand(runbook);
  if (!entryCommand) {
    throw new Error("Could not infer entry command from runbook for behavioral judge.");
  }

  let stdout = "";
  let stderr = "";

  if (baseUrl && isLongRunningDevServerCommand(entryCommand)) {
    stdout =
      "[Dev server was started during the README runbook step; output is not re-captured here to avoid blocking. Use the HTTP response below and repository source.]";
    stderr = "";
  } else {
    const run = await ctx.run(bashLc(entryCommand), {
      cwd: repoPath,
      timeoutMs: 120_000,
    });
    stdout = (run.stdout || "").slice(0, MAX_STDOUT);
    stderr = (run.stderr || "").slice(0, MAX_STDERR);
  }

  const fileMatch = entryCommand.match(/([\w./-]+\.(py|js|ts|tsx|jsx|mjs|cjs))/);
  const relative = fileMatch ? fileMatch[1].replace(/^\.\//, "") : null;
  let mainSourcePath = relative || "main";
  let mainSourceExcerpt = "";

  if (relative) {
    const abs = `${repoPath}/${relative}`;
    try {
      const content = await sandbox.files.read(abs);
      mainSourceExcerpt =
        (typeof content === "string" ? content : "").slice(0, MAX_SOURCE) ||
        "(empty file)";
      mainSourcePath = relative;
    } catch {
      mainSourceExcerpt = `(could not read ${relative})`;
    }
  } else {
    mainSourceExcerpt = "(could not infer main file from entry command)";
  }

  let httpBodyExcerpt = "";
  if (baseUrl) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(25_000) });
      const text = await res.text();
      httpBodyExcerpt = text.slice(0, MAX_HTTP);
    } catch (e) {
      httpBodyExcerpt = `Fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    entryCommand,
    stdout,
    stderr,
    mainSourcePath,
    mainSourceExcerpt,
    httpBodyExcerpt,
    repoLayoutExcerpt,
  };
}
