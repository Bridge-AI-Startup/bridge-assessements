import { randomUUID } from "crypto";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";
import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "../langchainAI.js";
import { getGradingEvidenceStorage } from "../gradingEvidence/storage.js";
import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { bashLc } from "./artifacts.js";
import {
  type BehavioralJudgeInput,
  type BehavioralJudgeResult,
  behavioralCitationsFieldSchema,
  buildJudgeEvidencePayload,
  MAX_BEHAVIORAL_CITATIONS,
} from "./judge.js";
import { behavioralInfo } from "./log.js";

const MAX_AGENT_ITERATIONS = 16;
const MAX_TOOL_OUTPUT = 12_000;
const MAX_FILE_SNIPPET = 16_000;
const BROWSER_GOTO_TIMEOUT_MS = 35_000;
const BROWSER_CLICK_TIMEOUT_MS = 20_000;
const BROWSER_FILL_TIMEOUT_MS = 20_000;
const MAX_SCREENSHOT_BYTES = 3_000_000;
const REGEX_PATTERN_MAX_LEN = 500;

export type AgentToolTraceEntry = {
  iteration: number;
  tool:
    | "run_command"
    | "read_file"
    | "browser_goto"
    | "browser_click"
    | "browser_fill"
    | "browser_screenshot"
    | "browser_expect";
  detail: string;
  outputPreview: string;
  success: boolean;
  /** Stored PNG path when tool is browser_screenshot (served via behavioral-artifact API). */
  artifactKey?: string;
};

const agentTurnSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("run_command"),
    cmd: z.string().min(1).max(4000),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("read_file"),
    relativePath: z.string().min(1).max(400),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("browser_goto"),
    urlPath: z.string().min(1).max(2000),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("browser_click"),
    selector: z.string().min(1).max(500),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("browser_fill"),
    selector: z.string().min(1).max(500),
    value: z.string().max(4000),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("browser_screenshot"),
    label: z.string().max(200).optional(),
    fullPage: z.boolean().optional(),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("browser_expect"),
    mode: z.enum(["contains", "not_contains", "regex"]),
    pattern: z.string().min(1).max(2000),
    thought: z.string().max(600).optional(),
  }),
  z.object({
    step: z.literal("finish"),
    verdict: z.enum(["pass", "fail", "inconclusive"]),
    rationale: z.string().max(3500),
    citations: behavioralCitationsFieldSchema,
    thought: z.string().max(600).optional(),
  }),
]);

export type AgentTurn = z.infer<typeof agentTurnSchema>;

function summarizeAgentAction(r: AgentTurn): string {
  switch (r.step) {
    case "run_command":
      return r.cmd.length > 220 ? `${r.cmd.slice(0, 220)}…` : r.cmd;
    case "read_file":
      return r.relativePath;
    case "browser_goto":
      return r.urlPath;
    case "browser_click":
      return r.selector;
    case "browser_fill":
      return `${r.selector} ← ${r.value.length} chars`;
    case "browser_screenshot":
      return r.label?.trim() || "viewport";
    case "browser_expect":
      return `${r.mode}: ${r.pattern.slice(0, 120)}${r.pattern.length > 120 ? "…" : ""}`;
    case "finish":
      return r.verdict;
    default:
      return String((r as { step: string }).step);
  }
}

function isSafeShellCommand(cmd: string): boolean {
  if (cmd.length > 5000) return false;
  const dangerous =
    /\b(rm\s+-rf|mkfs|dd\s+if=|curl\s+[^\n]*\|\s*(ba)?sh|wget\s+[^\n]*\|\s*(ba)?sh|:\(\)\{|: \| :|chmod\s+-R\s+777\s+\/|>\s*\/dev\/sd)\b/i;
  return !dangerous.test(cmd);
}

/**
 * Build absolute paths to try for read_file. Handles:
 * - LLM repeating the repo root folder name (e.g. `assessment/server/...` when cwd is already `.../assessment`)
 * - TypeScript: `.js` → `.ts` / `.tsx`, and `server/routes` → `server/src/routes` (same for client)
 */
function resolveJudgeReadCandidates(
  repoPath: string,
  relativePath: string
): string[] | null {
  const trimmed = relativePath.trim().replace(/^\/+/, "");
  let normalized = path.posix.normalize(trimmed);
  if (normalized.includes("..")) return null;

  const repoNorm = path.posix.normalize(repoPath.replace(/\\/g, "/"));
  const base = path.posix.basename(repoNorm);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length > 0 && segments[0] === base) {
    normalized = segments.slice(1).join("/");
  }
  if (!normalized || normalized === ".") {
    return null;
  }

  const primary = path.posix.join(repoNorm, normalized);
  if (!primary.startsWith(`${repoNorm}/`)) {
    return null;
  }

  const candidates: string[] = [];
  const add = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };

  add(primary);

  if (primary.includes("/server/routes/") && !primary.includes("/server/src/")) {
    add(primary.replace("/server/routes/", "/server/src/routes/"));
  }
  if (primary.includes("/client/routes/") && !primary.includes("/client/src/")) {
    add(primary.replace("/client/routes/", "/client/src/routes/"));
  }

  const snapshot = [...candidates];
  for (const p of snapshot) {
    if (p.endsWith(".js")) {
      add(p.slice(0, -3) + ".ts");
      add(p.slice(0, -3) + ".tsx");
      add(p.slice(0, -3) + ".jsx");
    }
    if (p.endsWith(".jsx")) {
      add(p.slice(0, -4) + ".tsx");
    }
  }

  // Many Express apps use a single `routes/index.ts` instead of `routes/assessments.ts`, etc.
  const snapshot3 = [...candidates];
  for (const p of snapshot3) {
    const m = p.match(/^(.*\/routes)\/[^/]+\.(ts|tsx|js|jsx)$/i);
    if (m && !/\/routes\/index\./i.test(p)) {
      add(`${m[1]}/index.ts`);
      add(`${m[1]}/index.tsx`);
    }
  }

  return candidates;
}

/** Only allow navigation to the same origin as the grading base URL (sandbox app). */
function resolveBrowserUrl(baseUrl: string, urlPath: string): string {
  const base = new URL(baseUrl);
  const raw = urlPath.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const u = new URL(raw);
    if (u.origin !== base.origin) {
      throw new Error(
        `Cross-origin navigation blocked (allowed origin: ${base.origin})`
      );
    }
    return u.toString();
  }
  const pathPart = raw.startsWith("/") ? raw : `/${raw}`;
  return new URL(pathPart, base).toString();
}

async function snapshotPageText(page: Page): Promise<string> {
  const title = await page.title();
  const text = await page.evaluate(
    () => document.body?.innerText?.trim() ?? ""
  );
  const combined = `Title: ${title}\n\nVisible text (truncated):\n${text}`;
  return combined.length <= MAX_TOOL_OUTPUT
    ? combined
    : `${combined.slice(0, MAX_TOOL_OUTPUT)}\n… (truncated)`;
}

/** Plain visible text only (for assertions), no title prefix. */
async function getVisibleTextForExpect(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText?.trim() ?? "");
}

function runBrowserExpect(
  mode: "contains" | "not_contains" | "regex",
  pattern: string,
  visible: string
): { pass: boolean; detail: string } {
  if (mode === "contains") {
    const pass = visible.includes(pattern);
    return {
      pass,
      detail: pass
        ? `Contains check passed: found literal substring (${pattern.length} chars).`
        : `Contains check failed: literal substring not found in visible text.`,
    };
  }
  if (mode === "not_contains") {
    const pass = !visible.includes(pattern);
    return {
      pass,
      detail: pass
        ? `Not-contains check passed: substring absent.`
        : `Not-contains check failed: forbidden substring appears in visible text.`,
    };
  }
  if (pattern.length > REGEX_PATTERN_MAX_LEN) {
    return {
      pass: false,
      detail: `Regex pattern too long (max ${REGEX_PATTERN_MAX_LEN} chars).`,
    };
  }
  try {
    const re = new RegExp(pattern);
    const pass = re.test(visible);
    return {
      pass,
      detail: pass
        ? `Regex check passed: pattern matches visible text.`
        : `Regex check failed: pattern does not match visible text.`,
    };
  } catch (e) {
    return {
      pass: false,
      detail: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export type AgentJudgeContext = BehavioralJudgeInput & {
  repoPath: string;
  ctx: GradingSandboxContext;
  /** Public HTTPS URL of the app in the sandbox (when README started a server). Enables browser_* tools. */
  baseUrl?: string;
  /** Required for browser_screenshot artifact keys (`submissions/<id>/…`). */
  submissionId?: string;
  /** Other criteria from the same assessment (each graded in its own run). Used to prevent cross-check reasoning. */
  otherBehavioralChecks?: string[];
};

/**
 * Tool-using agent: shell + repo reads + optional Playwright E2E-style browser steps,
 * then finishes with pass/fail/inconclusive.
 */
export async function runAgentBehavioralJudge(
  input: AgentJudgeContext
): Promise<BehavioralJudgeResult & { agentTrace: AgentToolTraceEntry[] }> {
  const trace: AgentToolTraceEntry[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;
  /** Set on first failed launch (or env); all later browser_* steps reuse this error without re-launching. */
  let browserLaunchError: string | null =
    process.env.BEHAVIORAL_SKIP_BROWSER === "1" ||
    process.env.BEHAVIORAL_SKIP_BROWSER === "true"
      ? "[browser disabled] BEHAVIORAL_SKIP_BROWSER is set; use read_file, run_command, and the seed HTTP excerpt instead of browser_* tools."
      : null;

  const ensureBrowserPage = async (): Promise<Page> => {
    if (browserLaunchError) {
      throw new Error(browserLaunchError);
    }
    if (!input.baseUrl?.trim()) {
      throw new Error("No baseUrl");
    }
    if (!page) {
      try {
        browser = await chromium.launch({ headless: true });
        const p = await browser.newPage();
        await p.setViewportSize({ width: 1280, height: 720 });
        page = p;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        browserLaunchError = `[browser unavailable] ${raw}\nOn this host install Chromium for Playwright: cd server && npx playwright install chromium`;
        throw new Error(browserLaunchError);
      }
    }
    return page;
  };

  const closeBrowser = async () => {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    page = null;
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    browser = null;
  };

  const browserHint = input.baseUrl
    ? `- step=browser_goto: open a path on the candidate's running app (urlPath like \`/\` or \`/orders\`). Same origin only.
- step=browser_click: click a CSS selector on the **current** page; then visible text snapshot.
- step=browser_fill: type into an input/textarea (\`selector\` + \`value\`). Clears then fills like Playwright. Then visible text snapshot.
- step=browser_screenshot: capture PNG of the viewport (or fullPage=true for tall pages). Stored server-side; you get an artifact key + short confirmation. Use after UI changes you need to preserve visually.
- step=browser_expect: assert on **visible** text — mode \`contains\` | \`not_contains\` | \`regex\` plus \`pattern\` (substring or JS regex source). Returns pass/fail + text excerpt. Use after navigation or actions.`
    : `- (Browser tools are disabled: no app URL was available for this run — CLI/script only. Do not emit browser_* steps; they will error.)`;

  const systemPrompt = `You are a grading agent with access to the candidate's repository inside an isolated Linux sandbox (current working directory for run_command is the repo root).

Tools (respond with exactly ONE structured action per turn):
- step=run_command: run a shell command (bash -lc). Use for: running tests, python -c snippets, grepping, small one-off checks. Prefer short commands.
- step=read_file: read a file path relative to repo root (e.g. order_processing.py, src/app.ts). Use to inspect logic the excerpt might have truncated.
${browserHint}
- step=finish: verdict (pass/fail/inconclusive), rationale, and \`citations\` (verbatim quotes). **JSON safety:** \`citations\` must be valid JSON strings: each item one line in the JSON (use \`\\n\` for line breaks inside a string). Escape internal \`"\` as \`\\"\`. Prefer **short** snippets (≤200 chars each, ideally ≤8 items; at most ${MAX_BEHAVIORAL_CITATIONS} items are kept) so the response is not truncated mid-JSON.

Rules:
- You MUST eventually use step=finish before iterations run out.
- **Mandatory \`run_command\` before finish (critical):** Read \`--- Grading runtime (automated — use for honesty) ---\` in the first user message.
  - If **App base URL available** is **yes**: you **must** use **at least one** \`step=run_command\` **in this agent session** before \`finish\`. Use it to hit the running app (e.g. \`curl -sS -i\` against paths you infer from \`read_file\` on routes; use **only** the **BASE_URL_FOR_CURL** origin from the user message — see **curl origin** below) and/or run a project test script (\`npm test\`, \`pytest\`, etc.) if the check concerns test results. **Do not** \`finish\` after **only** \`read_file\` / \`browser_*\` — always include a shell probe when the server URL exists. If every curl fails, you may still \`finish\` with **fail** or **inconclusive** and cite the failing command output.
  - If **App base URL available** is **no**: still **prefer** at least one \`run_command\` (\`rg\`, \`grep\`, or the README’s test command) when the check is about **behavior** or **repo-wide** logic; **only** for a narrow “this exact file contains X” style check may you \`finish\` from \`read_file\` alone.
- **Runtime vs static (critical):** Read \`--- Grading runtime (automated — use for honesty) ---\` in the first user message.
  - If the check concerns **HTTP/API behavior** — e.g. response JSON shape, **non-leakage** of ids, **status codes**, **rejecting** bad input, honeypot/bot rejection — and **App base URL available** is **yes** with a **successful** warmup GET: you **must** obtain **runtime** proof before \`finish\` with **pass**: use \`run_command\` to \`curl -s\` the relevant API paths (infer paths from \`read_file\` on routes; include needed headers if the app is behind /api). **Do not** pass such checks from \`read_file\` alone.
  - If **App base URL available** is **no**, or warmup GET **failed**, or **README runbook had a failed shell step** and the check **requires live HTTP** proof: you may use **inconclusive** (explain) — but if the check is **purely about source** (routes, auth, validators) and you **can** read the repo, still decide pass/fail from code. Do **not** use inconclusive just because relevant **files were not found**; see **Missing code** below.
  - For **purely static** checks (middleware on a route, file exists, validator chain present): \`read_file\` is enough — but see **Ownership** next; “static” does not mean “router only.”
- **Ownership / authorization (critical):** If the behavioral check asks that employers **cannot** access **another user’s** assessments/submissions, or that access is **scoped to the owner**, **do not pass** from **route + middleware alone** (e.g. \`verifyEmployerToken\` only proves an authenticated employer). You **must** \`read_file\` the **controller (or service) handler** for that route and confirm the code **binds the resource to the current employer/user** (e.g. lookup by assessment id **and** owner id, or 404 when not owned). If the handler loads by id **without** comparing to the authenticated owner, **fail** — even if middleware is present.
- **curl origin (critical):** If the user message includes \`--- BASE_URL_FOR_CURL ---\`, you **must** use **that exact URL** (scheme + host + port if present) as the origin for **every** \`curl\` to the candidate app. **Never** use \`http://127.0.0.1\`, \`http://localhost\`, or a port from the README/package.json for those probes — in the grading sandbox the app is reached via the **exposed** URL only; localhost curls usually **fail** or hit nothing even when the app is up. **browser_*** tools already use the same origin internally.
- **Reachability vs wrong URL:** If a \`curl\` prints a JSON body or \`-i\` shows an HTTP status line, the server **was** reachable for that request — do **not** claim “application could not be reached” unless \`curl\` shows connection refused / timeout. Distinguish **wrong origin** (fix: use BASE_URL_FOR_CURL) from **endpoint returned 404** (valid response for testing).
- **Honeypot / invite:** Endpoints named “invite” in the employer’s check often map to **share-link** or \`generate-link\` routes in code. Search with \`run_command\` \`rg -n "website|honeypot|generate-link|generateLink" server client\` and open validators — do **not** assume a file named \`invite.ts\` exists.
- **Missing code (critical):** After reasonable probing (repository layout, \`routes/index.ts\`, \`rg\`/grep for symbols from the behavioral check), if **no relevant implementation** exists in the clone (wrong paths resolved, still nothing; or no route/handler/validator to evaluate), finish with **fail** — the submission does not demonstrate the required code. **Do not** choose **inconclusive** only because files were missing or paths were guessed wrong.
- **Single-check scope (critical):** You grade **only** the one sentence in \`Behavioral check to evaluate\` below. The full assessment description is context; **other behavioral checks** (if listed) are scored in **separate** agent runs. Do **not** fail this check because the submission would fail a **different** check, unless the **current** sentence explicitly requires that behavior. **Do not double-penalize:** e.g. a wrong discount threshold belongs in the check that mentions that threshold—not in a check that only asks whether output **includes** fields such as item, quantity, cost, and discount **lines** (pass those on presence/readability of those fields; ignore whether the discount **amount** matches the spec unless this sentence says so).
- If a behavioral check needs an edge case (e.g. empty list), propose a concrete command that exercises it (e.g. python -c "import ..." or a here-doc) when possible.
- For **UI / website** behavioral checks and **baseUrl** is available: use **browser_goto**, **browser_click**, **browser_fill**, **browser_expect**, and **browser_screenshot** as needed; use **read_file** for implementation details.
- Do not require stdout to contain internal variable names unless the assignment demands it.
- **When THIS check explicitly** asks about correctness, thresholds, "correctly", or specific discount rules: compare code/stdout/UI to the assessment description and fail if they disagree.
- **When THIS check is only** about presence, labels, or format (e.g. "output includes …", "displays each …"): pass if those elements appear in the relevant output; do **not** import failures from unrelated requirements (e.g. wrong dollar threshold) unless THIS sentence ties pass/fail to that value.
- **Citation integrity (critical):** \`citations\` must be verbatim text from (1) **seed evidence**, OR (2) \`read_file\` from the repo, OR (3) **browser_*** visible text for UI checks, OR (4) **curl / HTTP** output from \`run_command\` when the check is about **actual API responses** (status/body/leaks). **Never** cite generic \`run_command\` stdout as proof of **source file** content unless that output is clearly a **file read** (e.g. \`cat\`) from the repo.
- For "source contains guard X": use **read_file** and **fail** if absent. For "page shows Y": use **browser_*** when baseUrl exists; **browser_expect** gives a deterministic pass/fail for substrings/regex on visible text.
- **run_command** is for the **declared entry command**, tests (\`pytest\`, \`npm test\`), or read-only inspection (\`rg\`, \`grep\`). Prefer **read_file** over shell-printed fake code for source claims.
- **Paths:** The **Repository layout** section shows real directories in this clone. Paths for \`read_file\` are **relative to the repository root** (the folder that contains the layout). **Do not** prefix with the root folder name again (e.g. if layout shows \`server/\` at the top, use \`server/src/routes/…\` not \`assessment/server/…\`). Prefer \`.ts\` / \`src/routes/\` when the repo is TypeScript—check the layout for \`package.json\` and actual file paths.
- **Routes layout:** APIs may live in one file (e.g. \`server/src/routes/index.ts\`) rather than \`routes/assessments.ts\` or \`routes/submissions.ts\`. If a guessed path is missing, open \`routes/index.ts\` (or \`server.ts\`) or run \`run_command\` \`rg 'listSubmissions|generate-link' server\` before concluding files are missing.
- **Verdict choice:** **fail** if the requirement is unmet in evidence, or **no locatable code** supports it after probing. **inconclusive** only when **code exists** but the correct pass/fail is **ambiguous**, or **runtime-only** proof is mandatory and the environment **cannot** provide it (e.g. app never reachable) — not for “could not find the file.”

Safety: only standard dev commands; no destructive patterns.`;

  const seed = buildJudgeEvidencePayload(input);

  const otherChecksBlock =
    Array.isArray(input.otherBehavioralChecks) &&
    input.otherBehavioralChecks.length > 0
      ? `\n--- Other behavioral checks (each scored in its own run; do not use them as reasons to fail *this* check unless the current check sentence requires it) ---\n${input.otherBehavioralChecks
          .map((c, idx) => `${idx + 1}. ${c}`)
          .join("\n")}\n`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${seed}${otherChecksBlock}

---

The sections above are from the real grading pipeline (clone + entry run + main file excerpt). Later messages labeled \`run_command result:\` may be **sandbox probes** you run yourself — that stdout is **not** the candidate's source tree unless it is clearly output from their **entry command** or a **file read** from the repo.
${
        input.baseUrl
          ? `\n--- BASE_URL_FOR_CURL (mandatory origin for curl and API probes — do not use localhost or README ports) ---\n${input.baseUrl}\n--- end BASE_URL ---\n\nSame URL applies to browser_* tools (path-only steps use this origin).\n`
          : "\n(No BASE_URL_FOR_CURL — App base URL was not available for this run. For HTTP checks you may try curl to a port shown in the runbook seed **if** the server was started in this sandbox, or use read_file for code-only proof; see Rules.)\n"
      }
You may use tools to gather more evidence for THIS behavioral check only. Start from the seed; use read_file to confirm anything claimed about code on disk.${
        input.baseUrl
          ? " The app is running — you **must** also use run_command (e.g. `curl -sS -i \"<BASE_URL_FOR_CURL>/…\"`) at least once before finish; see Rules → Mandatory run_command and curl origin. Use browser tools when the check is user-visible."
          : " Prefer run_command (tests, rg) when evaluating behavior; see Rules → Mandatory run_command."
      }`,
    },
  ];

  try {
    for (let iter = 1; iter <= MAX_AGENT_ITERATIONS; iter++) {
      behavioralInfo("agent_llm_wait", {
        submissionId: input.submissionId,
        iteration: iter,
        maxIterations: MAX_AGENT_ITERATIONS,
      });

      const { result } = await createChatCompletionWithStructuredOutput(
        "workflow_evaluation",
        messages,
        agentTurnSchema,
        {
          temperature: 0,
          maxTokens: 4600,
        }
      );

      if (result.step === "finish") {
        behavioralInfo("agent_finish", {
          submissionId: input.submissionId,
          iteration: iter,
          verdict: result.verdict,
        });
        return {
          verdict: result.verdict,
          rationale: result.rationale,
          citations: result.citations,
          agentTrace: trace,
        };
      }

      behavioralInfo("agent_action", {
        submissionId: input.submissionId,
        iteration: iter,
        step: result.step,
        detail: summarizeAgentAction(result),
      });

      messages.push({
        role: "assistant",
        content: JSON.stringify(result),
      });

      if (result.step === "run_command") {
        let outputPreview = "";
        let success = false;
        if (!isSafeShellCommand(result.cmd)) {
          outputPreview =
            "[blocked] Command rejected by safety policy. Try a narrower dev command.";
        } else {
          const tCmd = Date.now();
          const r = await input.ctx.run(bashLc(result.cmd), {
            cwd: input.repoPath,
            timeoutMs: 90_000,
          });
          behavioralInfo("agent_run_command_done", {
            submissionId: input.submissionId,
            iteration: iter,
            exitCode: r.exitCode,
            ms: Date.now() - tCmd,
          });
          success = r.exitCode === 0;
          const combined = `${r.stdout || ""}${
            r.stderr ? `\n[stderr]\n${r.stderr}` : ""
          }`;
          outputPreview = combined.slice(0, MAX_TOOL_OUTPUT);
        }
        trace.push({
          iteration: iter,
          tool: "run_command",
          detail: result.cmd,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `run_command result:\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "read_file") {
        const candidates = resolveJudgeReadCandidates(
          input.repoPath,
          result.relativePath
        );
        let outputPreview = "";
        let success = false;
        const repoNorm = path.posix.normalize(
          input.repoPath.replace(/\\/g, "/")
        );
        if (!candidates?.length) {
          outputPreview =
            "[error] Invalid or unsafe path (use paths relative to repo root; do not repeat the root folder name).";
        } else {
          let lastErr = "";
          for (const abs of candidates) {
            try {
              const content = await input.ctx.sandbox.files.read(abs);
              const text = typeof content === "string" ? content : "";
              const relShown =
                abs.startsWith(`${repoNorm}/`) || abs === repoNorm
                  ? abs.slice(repoNorm.length).replace(/^\//, "") || "."
                  : abs;
              outputPreview = `[resolved: ${relShown}]\n${text.slice(0, MAX_FILE_SNIPPET)}`;
              success = text.length > 0;
              if (text.length > MAX_FILE_SNIPPET) {
                outputPreview += "\n… (truncated)";
              }
              break;
            } catch (e) {
              lastErr = e instanceof Error ? e.message : String(e);
            }
          }
          if (!success) {
            outputPreview = `[error] Tried ${candidates.length} path(s), e.g. ${candidates
              .slice(0, 4)
              .map((p) => p.slice(repoNorm.length).replace(/^\//, "") || ".")
              .join(", ")}. Last: ${lastErr}`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "read_file",
          detail: result.relativePath,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `read_file (${result.relativePath}):\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "browser_goto") {
        let outputPreview = "";
        let success = false;
        if (!input.baseUrl?.trim()) {
          outputPreview =
            "[error] browser_goto requires a running app URL (web_server profile). This repo was graded as CLI-only.";
        } else {
          try {
            const url = resolveBrowserUrl(input.baseUrl, result.urlPath);
            const pg = await ensureBrowserPage();
            await pg.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: BROWSER_GOTO_TIMEOUT_MS,
            });
            outputPreview = await snapshotPageText(pg);
            success = true;
          } catch (e) {
            outputPreview = `[error] ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "browser_goto",
          detail: result.urlPath,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `browser_goto result:\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "browser_click") {
        let outputPreview = "";
        let success = false;
        if (!input.baseUrl?.trim()) {
          outputPreview =
            "[error] browser_click requires a running app URL (web_server profile). This repo was graded as CLI-only.";
        } else {
          try {
            const pg = await ensureBrowserPage();
            await pg.click(result.selector, {
              timeout: BROWSER_CLICK_TIMEOUT_MS,
            });
            await delay(300);
            outputPreview = await snapshotPageText(pg);
            success = true;
          } catch (e) {
            outputPreview = `[error] ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "browser_click",
          detail: result.selector,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `browser_click result:\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "browser_fill") {
        let outputPreview = "";
        let success = false;
        if (!input.baseUrl?.trim()) {
          outputPreview =
            "[error] browser_fill requires a running app URL (web_server profile).";
        } else {
          try {
            const pg = await ensureBrowserPage();
            await pg.fill(result.selector, result.value, {
              timeout: BROWSER_FILL_TIMEOUT_MS,
            });
            await delay(200);
            outputPreview = await snapshotPageText(pg);
            success = true;
          } catch (e) {
            outputPreview = `[error] ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "browser_fill",
          detail: `${result.selector} ← ${result.value.length} chars`,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `browser_fill result:\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "browser_screenshot") {
        let outputPreview = "";
        let success = false;
        let artifactKey: string | undefined;
        if (!input.baseUrl?.trim()) {
          outputPreview =
            "[error] browser_screenshot requires a running app URL (web_server profile).";
        } else if (!input.submissionId?.trim()) {
          outputPreview =
            "[error] browser_screenshot requires submission scope (internal).";
        } else {
          try {
            const pg = await ensureBrowserPage();
            const buf = await pg.screenshot({
              type: "png",
              fullPage: result.fullPage === true,
            });
            if (buf.length > MAX_SCREENSHOT_BYTES) {
              outputPreview = `[error] Screenshot too large (${buf.length} bytes).`;
            } else {
              const key = `submissions/${input.submissionId}/behavioral-agent/${randomUUID()}.png`;
              await getGradingEvidenceStorage().storeArtifact(key, buf);
              artifactKey = key;
              const label = result.label?.trim() || "viewport";
              outputPreview = `Saved PNG artifact (${label}${result.fullPage ? ", fullPage" : ""}).\nartifactKey: ${key}\n\n${await snapshotPageText(pg)}`;
              success = true;
            }
          } catch (e) {
            outputPreview = `[error] ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "browser_screenshot",
          detail: result.label?.trim() || "screenshot",
          outputPreview,
          success,
          ...(artifactKey ? { artifactKey } : {}),
        });
        messages.push({
          role: "user",
          content: `browser_screenshot result:\n${outputPreview}`,
        });
        continue;
      }

      if (result.step === "browser_expect") {
        let outputPreview = "";
        let success = false;
        if (!input.baseUrl?.trim()) {
          outputPreview =
            "[error] browser_expect requires a running app URL (web_server profile).";
        } else {
          try {
            const pg = await ensureBrowserPage();
            const visible = await getVisibleTextForExpect(pg);
            const { pass, detail } = runBrowserExpect(
              result.mode,
              result.pattern,
              visible
            );
            success = pass;
            const excerpt =
              visible.length <= 6000
                ? visible
                : `${visible.slice(0, 6000)}\n… (truncated)`;
            outputPreview = `mode=${result.mode}\npattern: ${result.pattern}\n${detail}\n\nVisible text for review:\n${excerpt}`;
          } catch (e) {
            outputPreview = `[error] ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }
        trace.push({
          iteration: iter,
          tool: "browser_expect",
          detail: `${result.mode}: ${result.pattern.slice(0, 120)}${result.pattern.length > 120 ? "…" : ""}`,
          outputPreview,
          success,
        });
        messages.push({
          role: "user",
          content: `browser_expect result:\n${outputPreview}`,
        });
        continue;
      }
    }

    return {
      verdict: "inconclusive",
      rationale: `Agent did not call finish within ${MAX_AGENT_ITERATIONS} tool steps.`,
      citations: [],
      agentTrace: trace,
    };
  } finally {
    await closeBrowser();
  }
}
