import { describe, expect, it } from "vitest";

import { buildFixtureArchive } from "../grading-eval/fixtures.js";
import {
  BEHAVIORAL_CHECKS,
  FIXTURE_VARIANTS,
  GRADING_PATHS,
  VARIANT_SPECS,
  comparePaths,
  compareVariant,
  estimateLlmCalls,
  summarizeEval,
  type ReportLike,
} from "../grading-eval/expectations.js";

/** A report shaped like the real one, with the verdicts the test wants. */
function reportWith(
  verdicts: Array<string | null>,
  extra: Partial<ReportLike> = {}
): ReportLike {
  return {
    setup: { status: "ready" },
    runbookSource: "llm",
    startedAt: "2026-08-13T00:00:00.000Z",
    completedAt: "2026-08-13T00:05:00.000Z",
    cases: verdicts.flatMap((verdict, checkIndex) =>
      verdict === null
        ? []
        : [
            {
              checkIndex,
              checkText: BEHAVIORAL_CHECKS[checkIndex],
              verdict,
              evidence: [
                {
                  type: "judge",
                  rationale: `rationale ${checkIndex}`,
                  agentTrace: [{}, {}],
                },
              ],
            },
          ]
    ),
    ...extra,
  };
}

/** A report from the deterministic path: verdicts settled with no judge call. */
function deterministicReportWith(verdicts: string[]): ReportLike {
  return {
    setup: { status: "ready" },
    runbookSource: "candidate_config",
    startedAt: "2026-08-13T00:00:00.000Z",
    completedAt: "2026-08-13T00:01:00.000Z",
    cases: verdicts.map((verdict, checkIndex) => ({
      checkIndex,
      checkText: BEHAVIORAL_CHECKS[checkIndex],
      verdict,
      verifiedBy: "http_sequence",
      evidence: [{ type: "http" }],
    })),
  };
}

describe("grading eval ground truth", () => {
  it("gives every variant an expected verdict for every check", () => {
    for (const variant of FIXTURE_VARIANTS) {
      const spec = VARIANT_SPECS[variant];
      expect(spec.expected).toHaveLength(BEHAVIORAL_CHECKS.length);
      expect(spec.defect.length).toBeGreaterThan(0);
    }
  });

  it("never expects inconclusive — the fixtures are unambiguous by construction", () => {
    for (const variant of FIXTURE_VARIANTS) {
      for (const expected of VARIANT_SPECS[variant].expected) {
        expect(["pass", "fail", "blocked"]).toContain(expected);
      }
    }
  });

  it("expects the reference variant to pass everything and every broken variant to fail something", () => {
    expect(VARIANT_SPECS.complete.expected.every((v) => v === "pass")).toBe(true);
    for (const variant of FIXTURE_VARIANTS.filter((v) => v !== "complete")) {
      expect(
        VARIANT_SPECS[variant].expected.some((v) => v !== "pass")
      ).toBe(true);
    }
  });
});

describe("compareVariant", () => {
  it("matches a perfect run on the reference variant", () => {
    const result = compareVariant(
      "complete",
      reportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    expect(result.matched).toBe(5);
    expect(result.total).toBe(5);
    expect(result.falsePasses).toBe(0);
    expect(result.falseFails).toBe(0);
    expect(result.undecided).toBe(0);
    expect(result.status).toBe("graded");
  });

  it("counts a pass on a known defect as a false pass", () => {
    // no-persistence must fail check 2 (survives restart); passing it is the
    // exact error the eval exists to catch.
    const result = compareVariant(
      "no-persistence",
      reportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    expect(result.falsePasses).toBe(1);
    expect(result.checks[2].falsePass).toBe(true);
    expect(result.checks[2].expected).toBe("fail");
    expect(result.matched).toBe(4);
  });

  it("counts every fake-pass credit separately", () => {
    const result = compareVariant(
      "fake-pass",
      reportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    expect(result.falsePasses).toBe(4);
    expect(result.matched).toBe(1);
  });

  it("counts a fail on working behavior as a false fail", () => {
    const result = compareVariant(
      "complete",
      reportWith(["fail", "pass", "pass", "pass", "pass"])
    );
    expect(result.falseFails).toBe(1);
    expect(result.falsePasses).toBe(0);
  });

  it("treats inconclusive as undecided rather than a match", () => {
    const result = compareVariant(
      "complete",
      reportWith(["inconclusive", "pass", "pass", "pass", "pass"])
    );
    expect(result.undecided).toBe(1);
    expect(result.matched).toBe(4);
    expect(result.falsePasses).toBe(0);
    expect(result.falseFails).toBe(0);
  });

  it("counts blocked as a match when the app could not boot, and as undecided otherwise", () => {
    const blocked = compareVariant(
      "wont-boot",
      reportWith(["blocked", "blocked", "blocked", "blocked", "blocked"], {
        setup: { status: "failed" },
      })
    );
    expect(blocked.matched).toBe(5);
    expect(blocked.undecided).toBe(0);

    const wronglyBlocked = compareVariant(
      "complete",
      reportWith(["blocked", "pass", "pass", "pass", "pass"])
    );
    expect(wronglyBlocked.undecided).toBe(1);
    expect(wronglyBlocked.matched).toBe(4);
  });

  it("reports a missing check rather than silently dropping it", () => {
    const result = compareVariant(
      "complete",
      reportWith(["pass", "pass", null, "pass", "pass"])
    );
    expect(result.checks[2].actual).toBeNull();
    expect(result.checks[2].match).toBe(false);
    expect(result.matched).toBe(4);
  });

  it("marks a variant that produced no report at all", () => {
    const result = compareVariant("complete", null);
    expect(result.status).toBe("missing");
    expect(result.matched).toBe(0);
    expect(result.estimatedLlmCalls).toBe(0);
    expect(result.wallClockMs).toBeNull();
  });
});

describe("estimateLlmCalls", () => {
  it("counts one call per agent tool step plus the finishing call", () => {
    // 5 checks x (2 trace steps + 1 finish) + 1 planner call.
    expect(estimateLlmCalls(reportWith(["pass", "pass", "pass", "pass", "pass"]))).toBe(16);
  });

  it("charges nothing for the planner when the candidate config was used", () => {
    const report = reportWith(["pass"], { runbookSource: "candidate_config" });
    expect(estimateLlmCalls(report)).toBe(3);
  });

  it("charges nothing for a check that was never judged", () => {
    const report: ReportLike = {
      runbookSource: "candidate_config",
      cases: [{ checkIndex: 0, verdict: "blocked", evidence: [] }],
    };
    expect(estimateLlmCalls(report)).toBe(0);
  });
});

describe("summarizeEval", () => {
  it("fails the run on a single false pass even when agreement is high", () => {
    const perfect = compareVariant("complete", reportWith(["pass", "pass", "pass", "pass", "pass"]));
    const oneFalsePass = compareVariant(
      "no-persistence",
      reportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    const summary = summarizeEval([perfect, perfect, perfect, perfect, oneFalsePass]);
    expect(summary.falsePasses).toBe(1);
    expect(summary.exactMatchRate).toBeGreaterThan(0.9);
    expect(summary.pass).toBe(false);
    expect(summary.failureReasons.join(" ")).toContain("false pass");
  });

  it("passes a clean run and aggregates cost", () => {
    const perfect = compareVariant("complete", reportWith(["pass", "pass", "pass", "pass", "pass"]));
    const summary = summarizeEval([perfect, perfect]);
    expect(summary.pass).toBe(true);
    expect(summary.matched).toBe(10);
    expect(summary.total).toBe(10);
    expect(summary.estimatedLlmCalls).toBe(32);
    expect(summary.wallClockMs).toBe(600_000);
  });

  it("fails when agreement drops below the floor", () => {
    const half = compareVariant(
      "complete",
      reportWith(["inconclusive", "inconclusive", "inconclusive", "pass", "pass"])
    );
    const summary = summarizeEval([half]);
    expect(summary.pass).toBe(false);
    expect(summary.failureReasons.join(" ")).toContain("below the");
  });

  it("fails when a variant produced no report", () => {
    const summary = summarizeEval([compareVariant("complete", null)]);
    expect(summary.pass).toBe(false);
    expect(summary.failureReasons.join(" ")).toContain("no report");
  });
});

describe("deterministic vs agent paths", () => {
  it("counts a check settled without an LLM, and charges it nothing", () => {
    const result = compareVariant(
      "complete",
      deterministicReportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    expect(result.deterministic).toBe(5);
    expect(result.estimatedLlmCalls).toBe(0);
    expect(result.matched).toBe(5);
  });

  it("still attributes an agent-judged check to the agent", () => {
    const result = compareVariant(
      "complete",
      reportWith(["pass", "pass", "pass", "pass", "pass"])
    );
    expect(result.deterministic).toBe(0);
  });

  it("reports full agreement when both paths reach the same verdicts", () => {
    const verdicts = ["pass", "pass", "fail", "pass", "pass"];
    const agreement = comparePaths(
      [compareVariant("no-persistence", deterministicReportWith(verdicts))],
      [compareVariant("no-persistence", reportWith(verdicts))]
    );
    expect(agreement.compared).toBe(5);
    expect(agreement.agreed).toBe(5);
    expect(agreement.agreementRate).toBe(1);
    expect(agreement.disagreements).toEqual([]);
  });

  it("credits the deterministic path when it catches a false pass the judge missed", () => {
    // The fake-pass trap: the judge blesses the echoed write, the write-then-read
    // sequence does not.
    const agreement = comparePaths(
      [
        compareVariant(
          "fake-pass",
          deterministicReportWith(["fail", "fail", "fail", "fail", "pass"])
        ),
      ],
      [compareVariant("fake-pass", reportWith(["pass", "pass", "fail", "fail", "pass"]))]
    );
    expect(agreement.deterministicOnlyCorrect).toBe(2);
    expect(agreement.agentOnlyCorrect).toBe(0);
    expect(agreement.disagreements).toHaveLength(2);
    expect(agreement.disagreements[0].correctPath).toBe("deterministic");
    expect(agreement.disagreements[0].expected).toBe("fail");
  });

  it("credits the agent when a spec was the thing that was wrong", () => {
    const agreement = comparePaths(
      [compareVariant("complete", deterministicReportWith(["inconclusive", "pass", "pass", "pass", "pass"]))],
      [compareVariant("complete", reportWith(["pass", "pass", "pass", "pass", "pass"]))]
    );
    expect(agreement.agentOnlyCorrect).toBe(1);
    expect(agreement.deterministicOnlyCorrect).toBe(0);
    expect(agreement.disagreements[0].correctPath).toBe("agent");
  });

  it("records a disagreement where neither path was right", () => {
    const agreement = comparePaths(
      [compareVariant("fake-pass", deterministicReportWith(["inconclusive", "fail", "fail", "fail", "pass"]))],
      [compareVariant("fake-pass", reportWith(["pass", "fail", "fail", "fail", "pass"]))]
    );
    expect(agreement.disagreements).toHaveLength(1);
    expect(agreement.disagreements[0].correctPath).toBe("neither");
    expect(agreement.deterministicOnlyCorrect).toBe(0);
    expect(agreement.agentOnlyCorrect).toBe(0);
  });

  it("compares nothing when a variant only ran on one path", () => {
    const agreement = comparePaths(
      [compareVariant("complete", deterministicReportWith(["pass", "pass", "pass", "pass", "pass"]))],
      [compareVariant("fake-pass", reportWith(["pass", "pass", "pass", "pass", "pass"]))]
    );
    expect(agreement.compared).toBe(0);
    expect(agreement.agreementRate).toBe(0);
  });

  it("aggregates how much of a run needed no LLM", () => {
    const summary = summarizeEval([
      compareVariant("complete", deterministicReportWith(["pass", "pass", "pass", "pass", "pass"])),
      compareVariant("complete", reportWith(["pass", "pass", "pass", "pass", "pass"])),
    ]);
    expect(summary.deterministic).toBe(5);
    expect(summary.total).toBe(10);
  });

  it("names both paths the runner knows how to grade", () => {
    expect(GRADING_PATHS).toEqual(["deterministic", "agent"]);
  });
});

describe("fixture archives", () => {
  it("builds the reference variant from the shared base", async () => {
    const archive = await buildFixtureArchive("complete");
    expect(archive.files).toContain("server.js");
    expect(archive.files).toContain("package.json");
    expect(archive.files).toContain("README.md");
    expect(archive.buffer.length).toBeGreaterThan(0);
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives every broken variant its own contents", async () => {
    const complete = await buildFixtureArchive("complete");
    const seen = new Map<string, string>([[complete.sha256, "complete"]]);
    for (const variant of FIXTURE_VARIANTS.filter((v) => v !== "complete")) {
      const archive = await buildFixtureArchive(variant);
      expect(archive.files).toEqual(complete.files);
      const clash = seen.get(archive.sha256);
      expect(clash, `${variant} archive is identical to ${clash}`).toBeUndefined();
      seen.set(archive.sha256, variant);
    }
  });
});
