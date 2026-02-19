/**
 * CLI script to test the LangChain assessment generation (two-step chain).
 * Used by notebooks/test-assessment-generation.ipynb; can also be run manually.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/test-assessment-generation.ts <path-to-job-description.txt> [--json]
 *   npx tsx src/scripts/test-assessment-generation.ts <path> --steps   # output step1 + assessment (one JSON line)
 *   npx tsx src/scripts/test-assessment-generation.ts --json   # read JD from stdin
 *
 * Requires server/config.env with at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { generateAssessmentComponents } from "../services/openai.js";
import { generateAssessmentComponentsWithSteps } from "../services/assessmentGeneration.js";

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const withSteps = args.includes("--steps");
  const fileArg = args.find((a) => a !== "--json" && a !== "--steps");

  let jobDescription: string;
  if (fileArg) {
    const path = resolve(process.cwd(), fileArg);
    jobDescription = readFileSync(path, "utf-8").trim();
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    jobDescription = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (!jobDescription) {
    console.error("No job description provided. Pass a file path or pipe content to stdin.");
    process.exit(1);
  }

  if (withSteps) {
    const { step1, assessment } = await generateAssessmentComponentsWithSteps(jobDescription);
    const out = JSON.stringify({ step1, assessment });
    console.log(out);
    return;
  }

  const result = await generateAssessmentComponents(jobDescription);
  if (jsonOnly) {
    console.log(JSON.stringify(result));
  } else {
    console.log("Title:", result.title);
    console.log("Time limit (minutes):", result.timeLimit);
    console.log("Description (preview):", result.description.slice(0, 200) + "...");
    console.log("\nFull JSON:");
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
