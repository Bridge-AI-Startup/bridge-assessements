/**
 * Eval runner: run assessment generation for every job description in server/eval/jobs/
 * and write outputs to server/eval_runs/<date>/.
 *
 * Usage (from server/ directory):
 *   npx tsx src/scripts/run-eval.ts
 *   npx tsx src/scripts/run-eval.ts --no-check   # skip running the checker on outputs
 *
 * Requires: server/config.env with AI API keys. Reads job files from server/eval/jobs/
 * (any .txt or .md). Writes one JSON file per job and, by default, runs the eval
 * checker and writes summary.json.
 */

import "../config/loadEnv.js";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { generateAssessmentComponents } from "../services/openai.js";
import { checkAssessmentOutput } from "./eval-assessment-output.js";

const EVAL_JOBS_DIR = join(process.cwd(), "eval", "jobs");
const EVAL_RUNS_DIR = join(process.cwd(), "eval_runs");

function getJobFiles(): string[] {
  const entries = readdirSync(EVAL_JOBS_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      files.push(join(EVAL_JOBS_DIR, e.name));
    }
  }
  return files.sort();
}

function getJobId(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.(txt|md)$/i, "");
}

function getOutputDir(): string {
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(EVAL_RUNS_DIR, date);
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

async function main() {
  const skipCheck = process.argv.includes("--no-check");

  let jobFiles: string[];
  try {
    jobFiles = getJobFiles();
  } catch (e) {
    console.error("Failed to read eval jobs dir:", EVAL_JOBS_DIR, e);
    process.exit(1);
  }

  if (jobFiles.length === 0) {
    console.error("No .txt or .md files in", EVAL_JOBS_DIR);
    process.exit(1);
  }

  const outDir = getOutputDir();
  console.log("Eval output directory:", outDir);
  console.log("Job files:", jobFiles.length);

  const results: Array<{ jobId: string; path: string; checkResult?: ReturnType<typeof checkAssessmentOutput> }> = [];

  for (const jobPath of jobFiles) {
    const jobId = getJobId(jobPath);
    let jobDescription: string;
    try {
      jobDescription = readFileSync(jobPath, "utf-8").trim();
    } catch (e) {
      console.error("Failed to read", jobPath, e);
      results.push({ jobId, path: "" });
      continue;
    }
    if (!jobDescription) {
      console.error("Empty job file:", jobPath);
      results.push({ jobId, path: "" });
      continue;
    }

    console.log("\nGenerating for", jobId, "...");
    try {
      const result = await generateAssessmentComponents(jobDescription);
      const outputPath = join(outDir, `${jobId}.json`);
      writeFileSync(outputPath, JSON.stringify({ title: result.title, description: result.description, timeLimit: result.timeLimit }, null, 2), "utf-8");
      console.log("  Wrote", outputPath);

      let checkResult: ReturnType<typeof checkAssessmentOutput> | undefined;
      if (!skipCheck) {
        checkResult = checkAssessmentOutput(result);
        if (checkResult.passed) {
          console.log("  Checks: passed");
        } else {
          console.log("  Checks: FAILED —", checkResult.violations.join("; "));
        }
      }
      results.push({ jobId, path: outputPath, checkResult });
    } catch (err) {
      console.error("  Error:", err);
      results.push({ jobId, path: "" });
    }
  }

  if (!skipCheck && results.some((r) => r.checkResult)) {
    const summary = {
      runAt: new Date().toISOString(),
      outputDir: outDir,
      jobs: results.map((r) => ({
        jobId: r.jobId,
        outputPath: r.path,
        passed: r.checkResult?.passed ?? null,
        violations: r.checkResult?.violations ?? [],
      })),
      totalJobs: results.length,
      passed: results.filter((r) => r.checkResult?.passed === true).length,
      failed: results.filter((r) => r.checkResult && !r.checkResult.passed).length,
    };
    const summaryPath = join(outDir, "summary.json");
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    console.log("\nSummary:", summaryPath);
    console.log(`Passed: ${summary.passed}/${summary.totalJobs}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
