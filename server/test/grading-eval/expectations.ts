/**
 * Ground truth for the behavioral-grading eval, plus the pure comparison and
 * metric logic. Kept free of I/O so it can be unit-tested without a sandbox.
 *
 * Each fixture variant is a deliberate, known deviation from the reference
 * implementation, so the correct verdict for every (variant, check) pair is not
 * a matter of opinion. That makes disagreement measurable — in particular the
 * one error that matters most in hiring: a **false pass**, where grading blesses
 * behavior the code demonstrably does not have.
 */

import type { BehavioralCheckSpec } from "../../src/services/behavioralGrading/checkSpecs.js";

/** What grading may conclude. `blocked` = the environment made verification impossible. */
export type ActualVerdict = "pass" | "fail" | "inconclusive" | "blocked";

/** What grading *should* conclude. Never `inconclusive` — the fixtures are unambiguous. */
export type ExpectedVerdict = "pass" | "fail" | "blocked";

export type FixtureVariant =
  | "complete"
  | "no-persistence"
  | "no-validation"
  | "fake-pass"
  | "wont-boot";

export const FIXTURE_VARIANTS: FixtureVariant[] = [
  "complete",
  "no-persistence",
  "no-validation",
  "fake-pass",
  "wont-boot",
];

export const ASSESSMENT_TITLE = "Notes service";

/**
 * The assessment description pins an observable interface. Deterministic
 * acceptance criteria are only legitimate when the assessment states the
 * contract, so the fixture assessment states it explicitly.
 */
export const ASSESSMENT_DESCRIPTION = `Build a small notes service that stores notes and lists them back.

Requirements:
- Expose a health endpoint at GET /health that returns 200 once the service is up.
- Expose GET /notes which returns { "notes": [...] } containing every note created so far.
- Expose POST /notes which accepts { "title": "..." } and returns 201 with the created note.
- Reject a POST /notes whose title is missing or blank with a 400 and an "error" message.
- Notes must survive a restart of the process — a note created before a restart must still be listed after it.
- The service listens on port 4310 unless PORT is set.`;

/**
 * Checks in the same plain-language, stack-agnostic register the product
 * generates (see PROMPT_GENERATE_BEHAVIORAL_CHECKS). Index order is the
 * `checkIndex` grading reports back.
 */
export const BEHAVIORAL_CHECKS: string[] = [
  "Someone can add a note.",
  "A note that was just added shows up in the list of notes.",
  "Notes are still there after the application is restarted.",
  "Trying to add a note without a title is rejected with a clear error message.",
  "Asking for the list of notes returns a response instead of an error.",
];

/**
 * The same five checks, each pinned to an acceptance spec so grading can settle
 * them by observation instead of inference. Aligned to `BEHAVIORAL_CHECKS` by
 * index, and `text` matches each sentence exactly — the resolver keys specs to
 * sentences, so a reworded check silently loses its spec.
 *
 * Every spec that concerns stored data goes through `{{nonce}}`: a value invented
 * per run, which is what separates "the app stored my note" from "the app returns
 * a fixed list". That is the whole reason the `fake-pass` variant cannot satisfy
 * these while satisfying a single shallow probe.
 */
export const BEHAVIORAL_CHECK_SPECS: BehavioralCheckSpec[] = [
  {
    id: "notes-add",
    text: BEHAVIORAL_CHECKS[0],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "Add a note",
          request: { method: "POST", path: "/notes", json: { title: "Added {{nonce}}" } },
          expect: { status: [201], bodyContains: ["{{nonce}}"] },
        },
        {
          label: "Confirm it was really stored",
          request: { method: "GET", path: "/notes" },
          expect: { status: [200], bodyContains: ["{{nonce}}"] },
        },
      ],
    },
  },
  {
    id: "notes-listed",
    text: BEHAVIORAL_CHECKS[1],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "Add a note",
          request: { method: "POST", path: "/notes", json: { title: "Listed {{nonce}}" } },
          expect: { status: [201] },
        },
        {
          label: "Read the list back",
          request: { method: "GET", path: "/notes" },
          expect: {
            status: [200],
            bodyContains: ["{{nonce}}"],
            json: [{ path: "notes", exists: true }],
          },
        },
      ],
    },
  },
  {
    id: "notes-survive-restart",
    text: BEHAVIORAL_CHECKS[2],
    kind: "restart_persistence",
    acceptance: {
      write: {
        label: "Add a note before the restart",
        request: { method: "POST", path: "/notes", json: { title: "Durable {{nonce}}" } },
        expect: { status: [201] },
      },
      read: {
        label: "Look for it after the restart",
        request: { method: "GET", path: "/notes" },
        expect: { status: [200], bodyContains: ["{{nonce}}"] },
      },
    },
  },
  {
    id: "notes-reject-blank-title",
    text: BEHAVIORAL_CHECKS[3],
    kind: "http",
    acceptance: {
      label: "Add a note with no title",
      request: {
        method: "POST",
        path: "/notes",
        json: { body: "no title on this one ({{nonce}})" },
      },
      expect: {
        status: [400, 422],
        // Any wording will do; what matters is that the refusal says something.
        bodyMatches: "error|Error|required|Required|invalid|Invalid|title|Title",
      },
    },
  },
  {
    id: "notes-list-responds",
    text: BEHAVIORAL_CHECKS[4],
    kind: "http",
    acceptance: {
      label: "Ask for the list of notes",
      request: { method: "GET", path: "/notes" },
      expect: { status: [200], json: [{ path: "notes", exists: true }] },
    },
  },
];

/**
 * Which way the eval verified a variant. Running both over identical code is how
 * the deterministic path earns its keep — same fixtures, same ground truth, and a
 * visible difference in agreement and LLM calls.
 */
export type GradingPath = "deterministic" | "agent";

export const GRADING_PATHS: GradingPath[] = ["deterministic", "agent"];

export type VariantSpec = {
  variant: FixtureVariant;
  /** What was deliberately broken, surfaced in the results file. */
  defect: string;
  /** Expected verdict per check, aligned to BEHAVIORAL_CHECKS by index. */
  expected: ExpectedVerdict[];
};

export const VARIANT_SPECS: Record<FixtureVariant, VariantSpec> = {
  complete: {
    variant: "complete",
    defect: "Nothing — reference implementation that satisfies every check.",
    expected: ["pass", "pass", "pass", "pass", "pass"],
  },
  "no-persistence": {
    variant: "no-persistence",
    defect:
      "Notes live in a module-level array, so they are gone after a restart. Everything else is correct.",
    expected: ["pass", "pass", "fail", "pass", "pass"],
  },
  "no-validation": {
    variant: "no-validation",
    defect:
      "A blank or missing title is accepted with a 201 instead of rejected with an error.",
    expected: ["pass", "pass", "pass", "fail", "pass"],
  },
  "fake-pass": {
    variant: "fake-pass",
    defect:
      "Both endpoints answer plausibly but nothing is stored — the list is hardcoded. A single shallow probe of either endpoint looks correct.",
    expected: ["fail", "fail", "fail", "fail", "pass"],
  },
  "wont-boot": {
    variant: "wont-boot",
    defect:
      "Requires a module that was never committed, so the app never starts and no check can be verified.",
    expected: ["blocked", "blocked", "blocked", "blocked", "blocked"],
  },
};

/** How a single (variant, check) pair came out. */
export type CheckComparison = {
  checkIndex: number;
  checkText: string;
  expected: ExpectedVerdict;
  actual: ActualVerdict | null;
  match: boolean;
  /** Grading blessed behavior the fixture does not have. The error that matters. */
  falsePass: boolean;
  /** Grading condemned behavior the fixture does have. */
  falseFail: boolean;
  /** Grading declined to decide something decidable. */
  undecided: boolean;
  rationale: string | null;
  /** How the verdict was reached — `agent`, or the acceptance kind that settled it. */
  verifiedBy: string | null;
};

export type VariantComparison = {
  variant: FixtureVariant;
  defect: string;
  status: "graded" | "missing";
  checks: CheckComparison[];
  matched: number;
  total: number;
  falsePasses: number;
  falseFails: number;
  undecided: number;
  /** Checks settled without an LLM call. */
  deterministic: number;
  estimatedLlmCalls: number;
  wallClockMs: number | null;
  setupStatus: string | null;
  runbookSource: string | null;
};

type ReportCaseLike = {
  checkIndex?: number;
  checkText?: string;
  verdict?: string;
  verifiedBy?: string;
  evidence?: Array<{
    type?: string;
    rationale?: string;
    agentTrace?: unknown[];
  }>;
};

export type ReportLike = {
  cases?: ReportCaseLike[];
  setup?: { status?: string };
  runbookSource?: string;
  runbookFallbackReason?: string;
  startedAt?: string;
  completedAt?: string;
};

function normalizeVerdict(raw: string | undefined): ActualVerdict | null {
  if (raw === "pass" || raw === "fail" || raw === "inconclusive" || raw === "blocked") {
    return raw;
  }
  return null;
}

/**
 * One structured LLM call per agent tool step plus the finishing call. Derived
 * from the report rather than instrumented in production code, so enabling the
 * eval costs the grading path nothing.
 */
export function estimateLlmCalls(report: ReportLike): number {
  const plannerCalls = report.runbookSource === "llm" ? 1 : 0;
  const judgeCalls = (report.cases ?? []).reduce((total, c) => {
    const judged = (c.evidence ?? []).filter((e) => e.type === "judge");
    return (
      total +
      judged.reduce((n, e) => n + (Array.isArray(e.agentTrace) ? e.agentTrace.length : 0) + 1, 0)
    );
  }, 0);
  return plannerCalls + judgeCalls;
}

function wallClockMs(report: ReportLike): number | null {
  if (!report.startedAt || !report.completedAt) return null;
  const ms = Date.parse(report.completedAt) - Date.parse(report.startedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** Compare one variant's real grading report against its known defect. */
export function compareVariant(
  variant: FixtureVariant,
  report: ReportLike | null,
  checks: string[] = BEHAVIORAL_CHECKS
): VariantComparison {
  const spec = VARIANT_SPECS[variant];
  const byIndex = new Map<number, ReportCaseLike>();
  for (const c of report?.cases ?? []) {
    if (typeof c.checkIndex === "number") byIndex.set(c.checkIndex, c);
  }

  const comparisons: CheckComparison[] = checks.map((checkText, checkIndex) => {
    const expected = spec.expected[checkIndex] ?? "pass";
    const found = byIndex.get(checkIndex);
    const actual = normalizeVerdict(found?.verdict);
    const judgeEvidence = (found?.evidence ?? []).find((e) => e.type === "judge");
    return {
      checkIndex,
      checkText,
      expected,
      actual,
      match: actual === expected,
      falsePass: expected !== "pass" && actual === "pass",
      falseFail: expected === "pass" && actual === "fail",
      undecided: actual === "inconclusive" || (actual === "blocked" && expected !== "blocked"),
      rationale: judgeEvidence?.rationale ?? null,
      verifiedBy: found?.verifiedBy ?? null,
    };
  });

  return {
    variant,
    defect: spec.defect,
    status: report ? "graded" : "missing",
    checks: comparisons,
    matched: comparisons.filter((c) => c.match).length,
    total: comparisons.length,
    falsePasses: comparisons.filter((c) => c.falsePass).length,
    falseFails: comparisons.filter((c) => c.falseFail).length,
    undecided: comparisons.filter((c) => c.undecided).length,
    deterministic: comparisons.filter(
      (c) => c.verifiedBy != null && c.verifiedBy !== "agent"
    ).length,
    estimatedLlmCalls: report ? estimateLlmCalls(report) : 0,
    wallClockMs: report ? wallClockMs(report) : null,
    setupStatus: report?.setup?.status ?? null,
    runbookSource: report?.runbookSource ?? null,
  };
}

export type EvalSummary = {
  variants: number;
  gradedVariants: number;
  matched: number;
  total: number;
  exactMatchRate: number;
  falsePasses: number;
  falseFails: number;
  undecided: number;
  undecidedRate: number;
  /** Checks settled without an LLM call. */
  deterministic: number;
  estimatedLlmCalls: number;
  wallClockMs: number;
  /** The gate: any false pass fails the run, regardless of overall agreement. */
  pass: boolean;
  failureReasons: string[];
};

/**
 * Aggregate the run. A false pass fails the whole eval: an assessment platform
 * that credits behavior the code lacks is worse than one that declines to judge.
 */
export function summarizeEval(
  comparisons: VariantComparison[],
  minExactMatchRate = 0.8
): EvalSummary {
  const total = comparisons.reduce((n, v) => n + v.total, 0);
  const matched = comparisons.reduce((n, v) => n + v.matched, 0);
  const falsePasses = comparisons.reduce((n, v) => n + v.falsePasses, 0);
  const falseFails = comparisons.reduce((n, v) => n + v.falseFails, 0);
  const undecided = comparisons.reduce((n, v) => n + v.undecided, 0);
  const exactMatchRate = total === 0 ? 0 : matched / total;

  const failureReasons: string[] = [];
  if (falsePasses > 0) {
    const offenders = comparisons
      .filter((v) => v.falsePasses > 0)
      .map((v) => `${v.variant} (${v.falsePasses})`)
      .join(", ");
    failureReasons.push(`${falsePasses} false pass(es): ${offenders}`);
  }
  if (total === 0) {
    failureReasons.push("No checks were graded.");
  } else if (exactMatchRate < minExactMatchRate) {
    failureReasons.push(
      `Exact-match rate ${(exactMatchRate * 100).toFixed(0)}% is below the ${(
        minExactMatchRate * 100
      ).toFixed(0)}% floor.`
    );
  }
  const missing = comparisons.filter((v) => v.status === "missing");
  if (missing.length > 0) {
    failureReasons.push(
      `${missing.length} variant(s) produced no report: ${missing
        .map((v) => v.variant)
        .join(", ")}`
    );
  }

  return {
    variants: comparisons.length,
    gradedVariants: comparisons.filter((v) => v.status === "graded").length,
    matched,
    total,
    exactMatchRate,
    falsePasses,
    falseFails,
    undecided,
    undecidedRate: total === 0 ? 0 : undecided / total,
    deterministic: comparisons.reduce((n, v) => n + v.deterministic, 0),
    estimatedLlmCalls: comparisons.reduce((n, v) => n + v.estimatedLlmCalls, 0),
    wallClockMs: comparisons.reduce((n, v) => n + (v.wallClockMs ?? 0), 0),
    pass: failureReasons.length === 0,
    failureReasons,
  };
}

export type PathDisagreement = {
  variant: FixtureVariant;
  checkIndex: number;
  checkText: string;
  expected: ExpectedVerdict;
  deterministic: ActualVerdict | null;
  agent: ActualVerdict | null;
  /** Which path (if either) got it right — the point of running both. */
  correctPath: GradingPath | "both" | "neither";
};

export type PathAgreement = {
  compared: number;
  agreed: number;
  agreementRate: number;
  disagreements: PathDisagreement[];
  /** Times the deterministic path was right where the agent judge was wrong. */
  deterministicOnlyCorrect: number;
  /** Times the agent judge was right where the deterministic path was wrong. */
  agentOnlyCorrect: number;
};

/**
 * Compare the two paths over identical code.
 *
 * Agreement alone is not the goal — a deterministic spec that merely reproduces
 * the agent's answer buys only speed and cost. What justifies the extra machinery
 * is `deterministicOnlyCorrect`: cases where making the request settled something
 * the judge got wrong, most importantly on the `fake-pass` variant.
 */
export function comparePaths(
  deterministic: VariantComparison[],
  agent: VariantComparison[]
): PathAgreement {
  const agentByVariant = new Map(agent.map((v) => [v.variant, v]));
  const disagreements: PathDisagreement[] = [];
  let compared = 0;
  let agreed = 0;
  let deterministicOnlyCorrect = 0;
  let agentOnlyCorrect = 0;

  for (const detVariant of deterministic) {
    const agentVariant = agentByVariant.get(detVariant.variant);
    if (!agentVariant) continue;
    const agentChecks = new Map(agentVariant.checks.map((c) => [c.checkIndex, c]));

    for (const detCheck of detVariant.checks) {
      const agentCheck = agentChecks.get(detCheck.checkIndex);
      if (!agentCheck) continue;
      compared += 1;
      if (detCheck.actual === agentCheck.actual) {
        agreed += 1;
        continue;
      }
      if (detCheck.match && !agentCheck.match) deterministicOnlyCorrect += 1;
      if (agentCheck.match && !detCheck.match) agentOnlyCorrect += 1;
      disagreements.push({
        variant: detVariant.variant,
        checkIndex: detCheck.checkIndex,
        checkText: detCheck.checkText,
        expected: detCheck.expected,
        deterministic: detCheck.actual,
        agent: agentCheck.actual,
        correctPath:
          detCheck.match && agentCheck.match
            ? "both"
            : detCheck.match
              ? "deterministic"
              : agentCheck.match
                ? "agent"
                : "neither",
      });
    }
  }

  return {
    compared,
    agreed,
    agreementRate: compared === 0 ? 0 : agreed / compared,
    disagreements,
    deterministicOnlyCorrect,
    agentOnlyCorrect,
  };
}
