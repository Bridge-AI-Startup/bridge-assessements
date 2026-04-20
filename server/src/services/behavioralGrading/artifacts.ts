import type { Sandbox } from "e2b";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import type { RunbookPlan } from "./schema.js";
import { behavioralInfo } from "./log.js";

const MAX_STDOUT = 14_000;
const MAX_STDERR = 6_000;
const MAX_SOURCE = 18_000;
const MAX_HTTP = 10_000;
const MAX_REPO_LAYOUT = 10_000;

/**
 * Per-command E2B limits. Use **0** to disable (see graderSandbox.ts): a finite timeout
 * (e.g. 120s) fails long first runs such as mongodb-memory-server downloading a binary.
 * The sandbox `timeoutMs` (BEHAVIORAL_GRADING_SANDBOX_TIMEOUT_MS) still caps total lifetime.
 */
/** Cap `find` in huge repos; must stay finite (0 = unbounded RPC risk). */
const LAYOUT_PROBE_TIMEOUT_MS = 120_000;
const ENTRY_COMMAND_TIMEOUT_MS = 0;

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
  behavioralInfo("artifacts_layout_start");
  let repoLayoutExcerpt = "";
  try {
    const layoutProbe = await ctx.run(
      bashLc(
        `echo "== find . (maxdepth 4) ==" && find . -maxdepth 4 2>/dev/null | sort | head -450 && echo "" && echo "== package.json ==" && find . -name package.json -maxdepth 10 2>/dev/null | head -40`
      ),
      {
        cwd: repoPath,
        timeoutMs: LAYOUT_PROBE_TIMEOUT_MS,
        requestTimeoutMs: LAYOUT_PROBE_TIMEOUT_MS,
      }
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
  behavioralInfo("artifacts_layout_done", {
    excerptChars: repoLayoutExcerpt.length,
  });

  const entryCommand = inferEntryCommand(runbook);
  if (!entryCommand) {
    throw new Error("Could not infer entry command from runbook for behavioral judge.");
  }

  let stdout = "";
  let stderr = "";

  const runbookRanStart = runbook.steps.some((s) => s.purpose === "start");

  // Never re-run blocking processes here: the runbook already executed `start` (often detached).
  // Missing `portsHint` means no public baseUrl, but re-running e.g. `npm run dev` or `tsx
  // server.ts` still blocks the shell forever with timeoutMs=0 → job stuck after runbook_executed.
  if (runbookRanStart || isLongRunningDevServerCommand(entryCommand)) {
    behavioralInfo("artifacts_entry_skipped", {
      reason: runbookRanStart ? "runbook_had_start_step" : "long_running_dev_pattern",
      entryPreview: entryCommand.slice(0, 120),
    });
    stdout = runbookRanStart
      ? "[Start step(s) already ran in the README runbook — see runbook command evidence; not re-run here to avoid blocking the sandbox.]"
      : baseUrl
        ? "[Dev server pattern skipped; runbook HTTP context below when URL exists.]"
        : "[Long-running dev command skipped (no public sandbox URL); use read_file / run_command curl against 127.0.0.1 if the runbook started a local server.]";
    stderr = "";
  } else {
    behavioralInfo("artifacts_entry_run", {
      preview: entryCommand.slice(0, 160),
    });
    const run = await ctx.run(bashLc(entryCommand), {
      cwd: repoPath,
      timeoutMs: ENTRY_COMMAND_TIMEOUT_MS,
      requestTimeoutMs: ENTRY_COMMAND_TIMEOUT_MS,
    });
    behavioralInfo("artifacts_entry_done", { exitCode: run.exitCode });
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
