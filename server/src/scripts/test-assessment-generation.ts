/**
 * Standalone script to test assessment generation from a job description.
 * Loads config.env, reads the job description from a file path, and prints the generated title, description, and time limit.
 *
 * Usage (from server/ directory):
 *   npx tsx src/scripts/test-assessment-generation.ts <path-to-job-description.txt>
 *
 * Example:
 *   npx tsx src/scripts/test-assessment-generation.ts /tmp/job.txt
 *
 * Used by notebooks/test-assessment-generation.ipynb.
 */

import "../config/loadEnv.js";
import { readFileSync } from "fs";
import { generateAssessmentComponents } from "../services/openai.js";

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const filePath = args.find((a) => a !== "--json");
if (!filePath) {
  console.error(
    "Usage: npx tsx src/scripts/test-assessment-generation.ts <path-to-job-description.txt> [--json]"
  );
  console.error("  --json  Print only one JSON line (title, timeLimit, description) for notebook parsing.");
  process.exit(1);
}

let jobDescription: string;
try {
  jobDescription = readFileSync(filePath, "utf-8").trim();
} catch (e) {
  console.error("Failed to read file:", filePath, e);
  process.exit(1);
}

if (!jobDescription) {
  console.error("Job description file is empty.");
  process.exit(1);
}

async function main() {
  if (!jsonOnly) {
    console.log("Generating assessment from job description...\n");
  }
  const result = await generateAssessmentComponents(jobDescription);
  if (jsonOnly) {
    const out: Record<string, unknown> = {
      title: result.title,
      timeLimit: result.timeLimit,
      description: result.description,
    };
    if (result.reviewFeedback != null && result.reviewFeedback.length > 0) {
      out.reviewFeedback = result.reviewFeedback;
    }
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    console.log("--- Title ---");
    console.log(result.title);
    console.log("\n--- Time limit (minutes) ---");
    console.log(result.timeLimit);
    if (result.reviewFeedback != null && result.reviewFeedback.length > 0) {
      console.log("\n--- Review feedback ---");
      console.log(result.reviewFeedback);
    }
    console.log("\n--- Description ---");
    console.log(result.description);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
