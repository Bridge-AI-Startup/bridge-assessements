/**
 * What the agent judge must have actually done before it is allowed to pass a
 * check.
 *
 * The failure mode these guards exist for: the agent writes its own script
 * (`python -c "..."`, a here-doc), runs it, sees the output it just authored, and
 * cites that as proof the candidate's product works. The verdict looks
 * well-evidenced and is worthless — the dashboard has long warned a reviewer to
 * check for this by hand, which is the wrong place to catch it.
 *
 * A pass must rest on one of three grounded sources:
 *   - the candidate's own files (`read_file`, or a shell read like `cat`/`rg`)
 *   - an HTTP response from the running app (`curl`)
 *   - text the app actually rendered (the `browser_*` tools)
 *
 * A `fail` gets one gate of its own. In a hiring product an unproven fail costs
 * the candidate more than an unproven pass costs the employer, and the grader's
 * own browser automation missing a control looks exactly like the app not having
 * one. Opening the page (`browser_goto`) is not enough: a fill/click timeout
 * after a successful load is still an automation miss. A UI fail stands only
 * once a mutating action succeeded *and* a `browser_expect` actually ran.
 *
 * Pure functions — no sandbox, no LLM — so every rule below is unit-tested.
 */

/** Structural shape of an agent trace entry; avoids importing back into agentJudge. */
export type TraceEntryLike = {
  tool: string;
  detail: string;
  outputPreview?: string;
  success?: boolean;
  artifactKey?: string;
};

export type ProofGuardCode =
  | "no_http_probe"
  | "no_ui_proof"
  | "probe_only_citations"
  | "unproven_ui_fail";

export type ProofGuardViolation = {
  code: ProofGuardCode;
  /** Corrective instruction handed back to the agent. */
  instruction: string;
  /** Why the verdict was not accepted, in language a recruiter can read. */
  explanation: string;
};

export type ProofGuardInput = {
  behavioralCheck: string;
  executionProfile: string;
  verdict: "pass" | "fail" | "inconclusive";
  citations: string[];
  trace: TraceEntryLike[];
  /** In-sandbox origin, when the app came up. */
  sandboxAppOrigin?: string;
  /** External browser URL, when web grading is available. */
  browserBaseUrl?: string;
};

const HTTP_CHECK =
  /\b(GET|POST|PATCH|PUT|DELETE|HTTP|endpoint|api|\/api\/|returns?\s+(HTTP\s+)?\d{3}|status\s+code|request|response)\b/i;

const UI_CHECK =
  /\b(page|screen|button|click|clicks|clicking|form|field|display|displays|displayed|shows?|shown|visible|banner|modal|dialog|dropdown|menu|nav|navigat\w*|dashboard|heading|label|browser|renders?|appears?|list is shown|ui)\b/i;

/** Commands that read the candidate's repository. */
const SHELL_FILE_READ = /(^|[|;&]\s*)(cat|head|tail|less|sed\s+-n|rg|grep|ls|find)\b/i;

/** Commands whose output the agent authored itself. */
const INLINE_PROBE =
  /(\bpython3?\s+-c\b|\bnode\s+-e\b|\bnode\s+--eval\b|\bruby\s+-e\b|\bperl\s+-e\b|\bphp\s+-r\b|<<\s*['"]?\w+['"]?|\bprintf\b|\becho\b)/i;

const CURL_PROBE = /\bcurl\b/i;

const BROWSER_TEXT_TOOLS = new Set([
  "browser_expect",
  "browser_snapshot",
  "browser_click_text",
  "browser_goto",
]);

/** Where a trace entry's output came from, for citation attribution. */
export type EvidenceSource = "repo" | "http" | "browser" | "agent_probe" | "none";

export function classifyTraceEntry(entry: TraceEntryLike): EvidenceSource {
  if (entry.tool === "read_file") return "repo";
  if (entry.tool.startsWith("browser_")) {
    return BROWSER_TEXT_TOOLS.has(entry.tool) ? "browser" : "none";
  }
  if (entry.tool !== "run_command") return "none";
  // Order matters: a probe that pipes into curl is still the agent's own script,
  // and a `cat` inside a here-doc is not a repo read.
  if (INLINE_PROBE.test(entry.detail)) return "agent_probe";
  if (CURL_PROBE.test(entry.detail)) return "http";
  if (SHELL_FILE_READ.test(entry.detail)) return "repo";
  return "none";
}

export function checkNeedsHttpProof(check: string, executionProfile: string): boolean {
  if (executionProfile === "cli_stdout") return false;
  return HTTP_CHECK.test(check);
}

export function checkNeedsUiProof(check: string): boolean {
  return UI_CHECK.test(check);
}

function hasCurlAgainstApp(trace: TraceEntryLike[], sandboxAppOrigin?: string): boolean {
  const origin = sandboxAppOrigin?.trim();
  return trace.some((t) => {
    if (t.tool !== "run_command" || !CURL_PROBE.test(t.detail)) return false;
    if (!origin) return true;
    return (
      t.detail.includes(origin) ||
      /\b127\.0\.0\.1:\d+/.test(t.detail) ||
      /\blocalhost:\d+/.test(t.detail)
    );
  });
}

/** A rendered-page assertion or a screenshot that actually captured something. */
function hasRenderedUiProof(trace: TraceEntryLike[]): boolean {
  return trace.some(
    (t) =>
      t.success !== false &&
      (t.tool === "browser_expect" ||
        (t.tool === "browser_screenshot" && Boolean(t.artifactKey)))
  );
}

/** Tools that put the page in front of the agent, as opposed to acting on it. */
const BROWSER_OBSERVATION_TOOLS = new Set([
  "browser_expect",
  "browser_snapshot",
  "browser_goto",
]);

/** Whether the agent ever got a look at the page it is about to fail. */
export function hasAnySuccessfulBrowserObservation(trace: TraceEntryLike[]): boolean {
  return trace.some((t) => {
    if (!t.tool.startsWith("browser_") || t.success === false) return false;
    if (t.tool === "browser_screenshot") return Boolean(t.artifactKey);
    return BROWSER_OBSERVATION_TOOLS.has(t.tool);
  });
}

export function hasFailedBrowserInteraction(trace: TraceEntryLike[]): boolean {
  return trace.some((t) => t.tool.startsWith("browser_") && t.success === false);
}

const BROWSER_MUTATION_TOOLS = new Set([
  "browser_fill",
  "browser_fill_role",
  "browser_click",
  "browser_click_role",
  "browser_click_text",
]);

/** A fill or click that errored — the selector miss that looks like a product fail. */
export function hasFailedBrowserMutation(trace: TraceEntryLike[]): boolean {
  return trace.some(
    (t) => BROWSER_MUTATION_TOOLS.has(t.tool) && t.success === false
  );
}

/**
 * The agent both drove the page and asserted on it. A fail after that is about
 * what the page showed, not about a locator the grader invented. `browser_expect`
 * only has to have *run* — a mismatch is the candidate fail we want to publish.
 */
export function hasProvenUiWalkthrough(trace: TraceEntryLike[]): boolean {
  const mutated = trace.some(
    (t) => BROWSER_MUTATION_TOOLS.has(t.tool) && t.success !== false
  );
  const asserted = trace.some((t) => t.tool === "browser_expect");
  return mutated && asserted;
}

/** Normalized for substring comparison; citation quoting is not byte-exact. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whether the pass rests on nothing but the agent's own scripts.
 *
 * Conservative on purpose. Trace output is truncated for the prompt, so a
 * citation can legitimately be missing from the stored preview — the rule
 * therefore only rejects when the probe is the *only* possible source, or when a
 * citation is positively found in probe output and in no grounded output.
 * Truncation makes this miss violations; it never invents one.
 */
export function passRestsOnAgentProbe(
  citations: string[],
  trace: TraceEntryLike[]
): boolean {
  const sources = trace.map((t) => ({ source: classifyTraceEntry(t), entry: t }));
  const probes = sources.filter((s) => s.source === "agent_probe");
  if (probes.length === 0) return false;

  const grounded = sources.filter(
    (s) => s.source === "repo" || s.source === "http" || s.source === "browser"
  );
  if (grounded.length === 0) return true;

  const groundedText = grounded
    .map((s) => normalize(s.entry.outputPreview ?? ""))
    .filter(Boolean);
  const probeText = probes
    .map((s) => normalize(s.entry.outputPreview ?? ""))
    .filter(Boolean);
  if (probeText.length === 0) return false;

  let foundInProbe = 0;
  for (const raw of citations) {
    const citation = normalize(raw);
    // Very short citations match too much text to attribute reliably.
    if (citation.length < 12) continue;
    if (groundedText.some((t) => t.includes(citation))) return false;
    if (probeText.some((t) => t.includes(citation))) foundInProbe += 1;
  }
  return foundInProbe > 0;
}

/**
 * The gates a verdict must clear. Returns null when the verdict stands.
 */
export function checkProofGuards(input: ProofGuardInput): ProofGuardViolation | null {
  if (input.verdict === "fail") {
    return checkFailGuards(input);
  }
  if (input.verdict !== "pass") return null;

  if (
    input.sandboxAppOrigin?.trim() &&
    checkNeedsHttpProof(input.behavioralCheck, input.executionProfile) &&
    !hasCurlAgainstApp(input.trace, input.sandboxAppOrigin)
  ) {
    return {
      code: "no_http_probe",
      instruction:
        "finish rejected: this check requires runtime HTTP proof. Run at least one `curl` against SANDBOX_APP_ORIGIN (e.g. curl -sS -i with the path from the behavioral check) before finish with pass. Do not use npm test or pytest.",
      explanation:
        "No HTTP request was made to the running app, so a pass could not be verified against its actual responses.",
    };
  }

  if (
    input.browserBaseUrl?.trim() &&
    checkNeedsUiProof(input.behavioralCheck) &&
    !hasRenderedUiProof(input.trace)
  ) {
    return {
      code: "no_ui_proof",
      instruction:
        "finish rejected: this check is about what a user sees. Before finishing with pass, use `browser_goto` and then either `browser_expect` (contains/regex on visible text) or `browser_screenshot` to show the page really renders it. Reading the source that is supposed to render it is not sufficient.",
      explanation:
        "The page was never asserted or captured in a browser, so a pass would rest on source code that is supposed to render it rather than on what the app actually showed.",
    };
  }

  if (passRestsOnAgentProbe(input.citations, input.trace)) {
    return {
      code: "probe_only_citations",
      instruction:
        "finish rejected: your citations come from output your own inline script produced (e.g. `python -c`, `node -e`, a here-doc), not from the candidate's product. Re-verify with `read_file` on their source, a `curl` against the running app, or the browser tools, and cite that instead.",
      explanation:
        "The cited evidence came from a script the grader wrote during the run, not from the candidate's code, an HTTP response, or a rendered page.",
    };
  }

  return null;
}

/**
 * A UI fail is rejected when a fill/click timed out and the agent never both
 * drove the page *and* asserted on it. A successful goto alone is not a
 * walkthrough — that is the test5 hole, where `input[type=text]` timed out on
 * an untyped field after the page loaded. A fail resting on source review or
 * curl, with no browser mutation, still stands.
 */
function checkFailGuards(input: ProofGuardInput): ProofGuardViolation | null {
  if (
    input.browserBaseUrl?.trim() &&
    checkNeedsUiProof(input.behavioralCheck) &&
    hasFailedBrowserMutation(input.trace) &&
    !hasProvenUiWalkthrough(input.trace)
  ) {
    return {
      code: "unproven_ui_fail",
      instruction:
        "finish rejected: a fill or click timed out, so nothing was proven about the page — a selector timeout is evidence about your automation, not about the app. Take a `browser_snapshot` first, then drive the page with `browser_click_role` / `browser_fill_role` using a role and accessible name from that snapshot (`browser_fill`'s selector is CSS, not a role name; `input[type=text]` does not match an untyped <input>). Only finish with fail after a successful fill or click *and* a `browser_expect` that actually ran.",
      explanation:
        "A browser fill or click timed out before the page was asserted, so the fail could not be distinguished from the grader's own automation missing the control.",
    };
  }

  return null;
}
