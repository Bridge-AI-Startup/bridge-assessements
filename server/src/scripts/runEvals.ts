/**
 * Eval harness for the transcript evaluation pipeline.
 * Tests all Phase 2 and Phase 3 services against the sample transcript.
 *
 * Run with: npx tsx src/scripts/runEvals.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import "../config/loadEnv.js";
import { evaluateCriterion } from "../services/evaluation/evaluator.js";
import { groundCriterion } from "../services/evaluation/grounder.js";
import { validateCriterion } from "../services/evaluation/validator.js";
import { retrieveRelevantEvents } from "../services/evaluation/retriever.js";
import { suggestCriteria } from "../services/evaluation/suggestCriteria.js";
import { evaluateTranscript } from "../services/evaluation/orchestrator.js";
import {
  averageScoreOverEvaluableCriteria,
  type TranscriptEvent,
} from "../types/evaluation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const transcriptPath = join(__dirname, "evals/transcripts/sample_two_sum.json");
const transcript: TranscriptEvent[] = JSON.parse(
  readFileSync(transcriptPath, "utf-8"),
);

const TEST_CRITERION = "Reviews AI generated code before accepting";
const TEST_JD =
  "Senior backend engineer. Builds and maintains Node.js APIs. Expected to write clean, efficient code and make good architectural decisions independently.";

function header(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

// ─── VALIDATOR ────────────────────────────────────────────────
async function testValidator() {
  header("PHASE 3: VALIDATOR");

  const cases = [
    {
      criterion: "Reviews AI generated code before accepting",
      expectValid: true,
    },
    { criterion: "Runs tests after implementing", expectValid: true },
    { criterion: "Shows good culture fit", expectValid: false },
    { criterion: "Is a team player", expectValid: false },
  ];

  const results = await Promise.allSettled(
    cases.map((c) => validateCriterion(c.criterion)),
  );

  for (let i = 0; i < cases.length; i++) {
    const { criterion, expectValid } = cases[i];
    const outcome = results[i];
    const pass =
      outcome.status === "fulfilled"
        ? outcome.value.valid === expectValid
          ? "PASS"
          : "FAIL"
        : "ERROR";

    console.log(`\n[${pass}] "${criterion}"`);
    if (outcome.status === "fulfilled") {
      console.log(`  valid: ${outcome.value.valid}`);
      if (outcome.value.reason)
        console.log(`  reason: ${outcome.value.reason}`);
    } else {
      console.error(`  error: ${outcome.reason}`);
    }
  }
}

// ─── GROUNDER ─────────────────────────────────────────────────
async function testGrounder() {
  header("PHASE 3: GROUNDER");

  console.log(`\nCriterion: "${TEST_CRITERION}"\n`);
  try {
    const grounded = await groundCriterion(TEST_CRITERION);
    console.log(`definition:          ${grounded.definition}`);
    console.log(
      `positive_indicators: ${grounded.positive_indicators.join(" | ")}`,
    );
    console.log(
      `negative_indicators: ${grounded.negative_indicators.join(" | ")}`,
    );
    console.log(
      `relevant_action_types: [${grounded.relevant_action_types.join(", ")}]`,
    );
    return grounded;
  } catch (err) {
    console.error(`ERROR: ${err}`);
    return null;
  }
}

// ─── RETRIEVER ────────────────────────────────────────────────
async function testRetriever() {
  header("PHASE 3: RETRIEVER");

  const grounded = await groundCriterion(TEST_CRITERION);
  if (!grounded) return;

  const filtered = retrieveRelevantEvents(transcript, grounded);
  console.log(`\nFull transcript:     ${transcript.length} events`);
  console.log(
    `Relevant action types: [${grounded.relevant_action_types.join(", ")}]`,
  );
  console.log(`Filtered transcript: ${filtered.length} events`);
  console.log(`\nFiltered events:`);
  for (const e of filtered) {
    console.log(
      `  [${e.ts}s-${e.ts_end}s] (${e.action_type}) ${e.description.slice(0, 80)}...`,
    );
  }
}

// ─── SUGGEST CRITERIA ─────────────────────────────────────────
async function testSuggestCriteria() {
  header("PHASE 3: SUGGEST CRITERIA");

  console.log(`\nJob description: "${TEST_JD}"\n`);
  try {
    const suggestions = await suggestCriteria(TEST_JD);
    suggestions.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  } catch (err) {
    console.error(`ERROR: ${err}`);
  }
}

// ─── EVALUATOR (Phase 2 smoke test) ──────────────────────────
async function testEvaluator() {
  header("PHASE 2: EVALUATOR (smoke test)");

  console.log(`\nCriterion: "${TEST_CRITERION}"\n`);
  try {
    const result = await evaluateCriterion(TEST_CRITERION, transcript);
    console.log(`SCORE:      ${result.score}/10`);
    console.log(`CONFIDENCE: ${result.confidence}`);
    console.log(`VERDICT:    ${result.verdict}`);
    console.log(`EVIDENCE (${result.evidence.length} items):`);
    for (const e of result.evidence) {
      console.log(`  [${e.ts}s-${e.ts_end}s] ${e.observation}`);
    }
  } catch (err) {
    console.error(`ERROR: ${err}`);
  }
}

// ─── FULL PIPELINE (Phase 4 orchestrator) ────────────────────
const FULL_PIPELINE_CRITERIA = [
  "Reviews AI generated code before accepting",
  "Optimizes beyond the first working solution",
  "Reads problem constraints carefully before coding",
  "Identifies contradictions or problems in the brief",
  "Uses AI as a crutch rather than a tool",
];

async function testFullPipeline() {
  header("PHASE 4: FULL PIPELINE (orchestrator)");

  console.log(
    `\nRunning orchestrator with ${FULL_PIPELINE_CRITERIA.length} criteria...\n`,
  );
  try {
    const report = await evaluateTranscript(transcript, FULL_PIPELINE_CRITERIA);
    console.log("SESSION SUMMARY:");
    console.log(report.session_summary);
    const avg = averageScoreOverEvaluableCriteria(report.criteria_results);
    console.log(`\nAverage score (evaluable criteria only): ${avg ?? "n/a"}`);
    console.log("\nCRITERIA RESULTS:");
    for (const r of report.criteria_results) {
      const tag = r.evaluable ? "" : " (not evaluable — excluded from average)";
      console.log(`\n  [${r.score}/10] ${r.criterion}${tag}`);
      console.log(`  Confidence: ${r.confidence}`);
      console.log(`  Verdict: ${r.verdict}`);
      console.log(`  Evidence: ${r.evidence.length} items`);
    }
  } catch (err) {
    console.error(`ERROR: ${err}`);
  }
}

async function run() {
  await testValidator();
  await testGrounder();
  await testRetriever();
  await testSuggestCriteria();
  await testEvaluator();
  await testFullPipeline();
  console.log("\n" + "=".repeat(60) + "\n");
}

run();
