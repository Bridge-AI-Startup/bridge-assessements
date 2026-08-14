/**
 * Behavioral-grading eval: measure whether grading verdicts are *correct*.
 *
 * Runs the real pipeline (E2B sandbox, runbook, agent judge — the same
 * `gradeSubmissionBehavioral` the controllers call) against a set of fixture
 * projects whose defects are known in advance, then compares every verdict
 * against ground truth in `expectations.ts`.
 *
 * The headline metric is **false passes**: cases where grading credited behavior
 * the fixture demonstrably does not have. Any false pass fails the run.
 *
 * Every variant is graded twice by default, once per path:
 *
 *  - **deterministic** — the assessment carries `behavioralCheckSpecs`, so
 *    acceptance criteria are executed against the running app with no LLM call.
 *  - **agent** — the same checks as plain sentences, judged by the agent judge.
 *
 * Identical fixtures and identical ground truth on both sides is what makes the
 * deterministic path's value measurable rather than assumed.
 *
 * Run:
 *   cd server
 *   npm run test:grading-eval
 *   npm run test:grading-eval -- --variants=complete,fake-pass   # subset
 *   npm run test:grading-eval -- --paths=deterministic           # one path only
 *   GRADING_EVAL_NO_CLEANUP=true npm run test:grading-eval       # keep Mongo rows
 *
 * Requires BEHAVIORAL_GRADING_ENABLED=true, E2B_API_KEY, an AI provider key, and
 * Mongo. Each (variant, path) pair is a full grading run, so budget several
 * minutes apiece.
 */

import "../../src/config/loadEnv.js";

import fs from "fs/promises";
import path from "path";

import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import SubmissionModel from "../../src/models/submission.js";
import UserModel from "../../src/models/user.js";
import {
  gradeSubmissionBehavioral,
  isBehavioralGradingEnabled,
} from "../../src/services/behavioralGrading/index.js";
import { getSubmissionCodeStorage } from "../../src/services/submissionCode/storage.js";

import { withTimeout } from "../e2e/lib/runner.js";
import { RESULTS_DIR, ensureDirs, repoRelative, saveEvidenceFile } from "../e2e/lib/evidence.js";
import { buildFixtureArchive } from "./fixtures.js";
import {
  ASSESSMENT_DESCRIPTION,
  ASSESSMENT_TITLE,
  BEHAVIORAL_CHECKS,
  BEHAVIORAL_CHECK_SPECS,
  FIXTURE_VARIANTS,
  GRADING_PATHS,
  compareVariant,
  comparePaths,
  summarizeEval,
  type FixtureVariant,
  type GradingPath,
  type VariantComparison,
} from "./expectations.js";

/** Hard per-variant wall-clock cap so one hung sandbox cannot jam the run. */
const VARIANT_BUDGET_MS = numEnv("GRADING_EVAL_VARIANT_BUDGET_MS", 20 * 60 * 1000);
const RESULTS_FILE = path.join(RESULTS_DIR, "grading-eval-results.json");
const TEST_EMAIL_DOMAIN = "bridge-e2e.test";

const log = (m: string) => console.log(`[grading-eval] ${m}`);

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function listFlag(flag: string, envVar: string): string[] | null {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  const raw = arg ? arg.slice(`--${flag}=`.length) : process.env[envVar];
  if (!raw?.trim()) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function selectedVariants(): FixtureVariant[] {
  const requested = listFlag("variants", "GRADING_EVAL_VARIANTS");
  if (!requested) return FIXTURE_VARIANTS;
  const unknown = requested.filter(
    (r) => !FIXTURE_VARIANTS.includes(r as FixtureVariant)
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown variant(s): ${unknown.join(", ")}. Known: ${FIXTURE_VARIANTS.join(", ")}`
    );
  }
  return requested as FixtureVariant[];
}

function selectedPaths(): GradingPath[] {
  const requested = listFlag("paths", "GRADING_EVAL_PATHS");
  if (!requested) return GRADING_PATHS;
  const unknown = requested.filter((r) => !GRADING_PATHS.includes(r as GradingPath));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown path(s): ${unknown.join(", ")}. Known: ${GRADING_PATHS.join(", ")}`
    );
  }
  return requested as GradingPath[];
}

async function main() {
  const startedAt = Date.now();

  if (!isBehavioralGradingEnabled()) {
    throw new Error(
      "BEHAVIORAL_GRADING_ENABLED is not set — the eval grades through the real pipeline and cannot run with grading disabled."
    );
  }
  if (!process.env.E2B_API_KEY?.trim()) {
    throw new Error("E2B_API_KEY is required — every variant needs a real sandbox.");
  }

  const variants = selectedVariants();
  const paths = selectedPaths();
  await connectMongoose();
  await ensureDirs();

  const stamp = Date.now();
  const email = `e2e+gradingeval.${stamp}@${TEST_EMAIL_DOMAIN}`;
  const storage = getSubmissionCodeStorage();
  const storageKeys: string[] = [];
  const byPath = new Map<GradingPath, VariantComparison[]>();
  const errors: Array<{ path: GradingPath; variant: string; error: string }> = [];

  log(
    `Grading ${variants.length} variant(s) [${variants.join(", ")}] ` +
      `on ${paths.length} path(s) [${paths.join(", ")}]`
  );

  const user = await UserModel.create({
    firebaseUid: `e2e-gradingeval-${stamp}`,
    email,
    companyName: "E2E Grading Eval Co",
  });

  // One assessment per path: same sentences either way, so the only difference
  // grading sees is whether acceptance criteria are attached.
  const createPathAssessment = (path_: GradingPath) =>
    AssessmentModel.create({
      userId: user._id,
      title: `${ASSESSMENT_TITLE} (grading eval ${stamp}, ${path_})`,
      description: ASSESSMENT_DESCRIPTION,
      timeLimit: 120,
      behavioralChecks: BEHAVIORAL_CHECKS,
      ...(path_ === "deterministic"
        ? { behavioralCheckSpecs: BEHAVIORAL_CHECK_SPECS }
        : {}),
    });

  const assessments = new Map<
    GradingPath,
    Awaited<ReturnType<typeof createPathAssessment>>
  >();
  for (const path_ of paths) {
    assessments.set(path_, await createPathAssessment(path_));
  }

  // Archives are path-independent: build and upload once, grade from both sides,
  // so the two paths are provably looking at the same bytes.
  const archives = new Map<
    FixtureVariant,
    { storageKey: string; sizeBytes: number; sha256: string }
  >();

  try {
    for (const variant of variants) {
      const archive = await buildFixtureArchive(variant);
      const storageKey = `grading-eval/${stamp}/${variant}.zip`;
      await storage.storeArchive(storageKey, archive.buffer);
      storageKeys.push(storageKey);
      archives.set(variant, {
        storageKey,
        sizeBytes: archive.buffer.length,
        sha256: archive.sha256,
      });
      log(
        `${variant} archive: ${archive.files.length} files, ` +
          `${(archive.buffer.length / 1024).toFixed(1)} KB, sha ${archive.sha256.slice(0, 12)}`
      );
    }

    for (const path_ of paths) {
      const comparisons: VariantComparison[] = [];
      byPath.set(path_, comparisons);
      const assessment = assessments.get(path_)!;
      log("");
      log(`===== path: ${path_} =====`);

      for (const variant of variants) {
        const variantStart = Date.now();
        log(`--- ${path_} / ${variant} ---`);
        try {
          const archive = archives.get(variant)!;
          const submission = await SubmissionModel.create({
            assessmentId: assessment._id,
            candidateName: `Eval ${variant} (${path_})`,
            candidateEmail: email,
            status: "submitted",
            submittedAt: new Date(),
            codeSource: "upload",
            codeUpload: {
              storageKey: archive.storageKey,
              originalFilename: `${variant}.zip`,
              sizeBytes: archive.sizeBytes,
              sha256: archive.sha256,
              uploadedAt: new Date(),
            },
          });

          const report = await withTimeout(
            gradeSubmissionBehavioral(submission._id.toString()),
            VARIANT_BUDGET_MS,
            `grading ${variant} (${path_})`
          );

          await saveEvidenceFile(
            `grading-eval-${path_}-${variant}-report.json`,
            JSON.stringify(report, null, 2)
          );

          const comparison = compareVariant(variant, report as never);
          comparisons.push(comparison);
          log(
            `${path_}/${variant}: ${comparison.matched}/${comparison.total} matched, ` +
              `${comparison.falsePasses} false pass, ${comparison.falseFails} false fail, ` +
              `${comparison.undecided} undecided, ${comparison.deterministic} without an LLM, ` +
              `~${comparison.estimatedLlmCalls} LLM calls, ` +
              `${((Date.now() - variantStart) / 1000).toFixed(0)}s`
          );
          for (const c of comparison.checks) {
            if (!c.match) {
              log(
                `  MISMATCH check ${c.checkIndex} expected=${c.expected} actual=${c.actual ?? "none"}` +
                  `${c.falsePass ? " [FALSE PASS]" : ""} — ${c.checkText}`
              );
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`${path_}/${variant}: FAILED — ${message}`);
          errors.push({ path: path_, variant, error: message });
          comparisons.push(compareVariant(variant, null));
        }
      }
    }

    const summaries = paths.map((path_) => ({
      path: path_,
      summary: summarizeEval(byPath.get(path_) ?? []),
    }));
    const deterministicRuns = byPath.get("deterministic");
    const agentRuns = byPath.get("agent");
    const agreement =
      deterministicRuns && agentRuns ? comparePaths(deterministicRuns, agentRuns) : null;

    const results = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? null,
        AI_PROVIDER: process.env.AI_PROVIDER ?? null,
        OPENAI_MODEL_WORKFLOW_EVALUATION:
          process.env.OPENAI_MODEL_WORKFLOW_EVALUATION ?? null,
        BEHAVIORAL_GRADING_SANDBOX_TIMEOUT_MS:
          process.env.BEHAVIORAL_GRADING_SANDBOX_TIMEOUT_MS ?? null,
      },
      status: summaries.every((s) => s.summary.pass) ? "pass" : "fail",
      paths: summaries.map((s) => ({
        path: s.path,
        summary: s.summary,
        variants: byPath.get(s.path) ?? [],
      })),
      agreement,
      errors,
      checks: BEHAVIORAL_CHECKS,
    };
    await fs.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2), "utf-8");

    log("");
    for (const { path: path_, summary } of summaries) {
      log(
        `[${path_}] exact match ${summary.matched}/${summary.total} ` +
          `(${(summary.exactMatchRate * 100).toFixed(0)}%)   ` +
          `false pass ${summary.falsePasses}   false fail ${summary.falseFails}   ` +
          `undecided ${summary.undecided} (${(summary.undecidedRate * 100).toFixed(0)}%)   ` +
          `${summary.deterministic} settled without an LLM   ~${summary.estimatedLlmCalls} LLM calls`
      );
    }
    if (agreement) {
      log(
        `paths agreed on ${agreement.agreed}/${agreement.compared} ` +
          `(${(agreement.agreementRate * 100).toFixed(0)}%); ` +
          `deterministic-only correct ${agreement.deterministicOnlyCorrect}, ` +
          `agent-only correct ${agreement.agentOnlyCorrect}`
      );
      for (const d of agreement.disagreements) {
        log(
          `  DISAGREE ${d.variant} check ${d.checkIndex}: expected=${d.expected} ` +
            `deterministic=${d.deterministic ?? "none"} agent=${d.agent ?? "none"} ` +
            `(right: ${d.correctPath})`
        );
      }
    }
    log(`results: ${repoRelative(RESULTS_FILE)}`);
    const failed = summaries.filter((s) => !s.summary.pass);
    for (const { path: path_, summary } of failed) {
      for (const reason of summary.failureReasons) log(`FAIL [${path_}]: ${reason}`);
    }
    return failed.length === 0;
  } finally {
    const assessmentIds = [...assessments.values()].map((a) => a._id);
    if (process.env.GRADING_EVAL_NO_CLEANUP === "true") {
      log(
        `Skipping cleanup (GRADING_EVAL_NO_CLEANUP=true). Assessments ${assessmentIds.join(", ")}`
      );
    } else {
      await SubmissionModel.deleteMany({ assessmentId: { $in: assessmentIds } });
      await AssessmentModel.deleteMany({ _id: { $in: assessmentIds } });
      await UserModel.deleteOne({ _id: user._id });
      for (const key of storageKeys) await storage.delete(key).catch(() => {});
      log("Cleaned up seeded user/assessments/submissions and fixture archives.");
    }
  }
}

main()
  .then(async (passed) => {
    const mongoose = await import("mongoose");
    await mongoose.default.connection.close();
    process.exit(passed ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("[grading-eval] failed:", err);
    try {
      const mongoose = await import("mongoose");
      await mongoose.default.connection.close();
    } catch {
      /* connection may never have opened */
    }
    process.exit(1);
  });
