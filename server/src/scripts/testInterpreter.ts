/**
 * Test harness for the Activity Interpreter.
 * Runs both Strategy A (chunked) and Strategy B (stateful) on synthetic
 * and real transcripts, then prints a side-by-side comparison with
 * LLM-as-judge quality scores.
 *
 * Usage: npx tsx src/scripts/testInterpreter.ts [--skip-judge] [--fixture name]
 */

import "../config/loadEnv.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jsonlToScreenMoments } from "../services/evaluation/momentGrouper.js";
import { interpretChunked } from "../services/evaluation/interpreterChunked.js";
import { interpretStateful } from "../services/evaluation/interpreterStateful.js";
import { judgeEnrichedTranscript } from "../services/evaluation/llmJudge.js";
import type { EnrichedTranscript, ScreenMoment } from "../types/evaluation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "evals", "transcripts");
const OUTPUTS_DIR = path.join(__dirname, "evals", "outputs");

const skipJudge = process.argv.includes("--skip-judge");
const fixtureFilter = (() => {
  const idx = process.argv.indexOf("--fixture");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

interface TestResult {
  fixture: string;
  strategy: string;
  time: number;
  calls: number;
  tokens: number;
  eventCount: number;
  accuracy?: number;
  specificity?: number;
  insight?: number;
}

async function main() {
  console.log("=== Activity Interpreter Test Harness ===\n");

  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

  const fixtures = discoverFixtures();
  if (fixtures.length === 0) {
    console.log("No fixtures found in", FIXTURES_DIR);
    return;
  }

  console.log(`Found ${fixtures.length} fixture(s): ${fixtures.map((f) => f.name).join(", ")}\n`);

  const results: TestResult[] = [];

  for (const fixture of fixtures) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`FIXTURE: ${fixture.name}`);
    console.log(`${"=".repeat(60)}`);

    const jsonl = fs.readFileSync(fixture.path, "utf-8");
    const moments = jsonlToScreenMoments(jsonl);
    console.log(`  Parsed ${moments.length} screen moments from ${countLines(jsonl)} raw JSONL lines\n`);

    // Strategy A: Chunked
    console.log("--- Strategy A: LLM-Chunked ---");
    const chunkedResult = await runStrategy("chunked", moments, fixture.name);
    results.push(chunkedResult);

    // Strategy B: Stateful
    console.log("\n--- Strategy B: Stateful-Sequential ---");
    const statefulResult = await runStrategy("stateful", moments, fixture.name);
    results.push(statefulResult);
  }

  // Print comparison table
  printComparisonTable(results);
}

function discoverFixtures(): { name: string; path: string }[] {
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.startsWith("raw_") && f.endsWith(".jsonl"));

  return files
    .filter((f) => !fixtureFilter || f.includes(fixtureFilter))
    .map((f) => ({
      name: f.replace(".jsonl", ""),
      path: path.join(FIXTURES_DIR, f),
    }));
}

async function runStrategy(
  strategy: "chunked" | "stateful",
  moments: ScreenMoment[],
  fixtureName: string
): Promise<TestResult> {
  const startTime = Date.now();

  let enriched: EnrichedTranscript;
  try {
    enriched =
      strategy === "chunked"
        ? await interpretChunked(moments)
        : await interpretStateful(moments);
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return {
      fixture: fixtureName,
      strategy,
      time: Date.now() - startTime,
      calls: 0,
      tokens: 0,
      eventCount: 0,
    };
  }

  const elapsed = Date.now() - startTime;

  // Print events
  console.log(`  Events (${enriched.events.length}):`);
  for (const e of enriched.events) {
    console.log(`    [${e.ts.toFixed(0)}s - ${e.ts_end.toFixed(0)}s] (${e.intent})`);
    console.log(`      ${e.behavioral_summary}`);
  }
  console.log(`\n  Narrative: ${enriched.session_narrative}`);
  console.log(`  Stats: ${enriched.processing_stats.llm_calls} calls, ${elapsed}ms`);

  // Save output
  const outputPath = path.join(OUTPUTS_DIR, `${fixtureName}_${strategy}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2));
  console.log(`  Output saved to: ${outputPath}`);

  const result: TestResult = {
    fixture: fixtureName,
    strategy,
    time: elapsed,
    calls: enriched.processing_stats.llm_calls,
    tokens: enriched.processing_stats.total_tokens,
    eventCount: enriched.events.length,
  };

  // LLM Judge
  if (!skipJudge) {
    console.log("  Running LLM-as-judge...");
    try {
      const scores = await judgeEnrichedTranscript(moments, enriched);
      result.accuracy = scores.accuracy;
      result.specificity = scores.specificity;
      result.insight = scores.behavioral_insight;
      console.log(`  Judge scores: accuracy=${scores.accuracy} specificity=${scores.specificity} insight=${scores.behavioral_insight}`);
      console.log(`  Justification: ${scores.justification}`);
    } catch (err) {
      console.error(`  Judge error: ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}

function printComparisonTable(results: TestResult[]) {
  console.log(`\n\n${"=".repeat(100)}`);
  console.log("COMPARISON TABLE");
  console.log("=".repeat(100));

  const header = padRow([
    "Fixture",
    "Strategy",
    "Time",
    "Calls",
    "Events",
    "Accuracy",
    "Specificity",
    "Insight",
  ]);
  const separator = "-".repeat(100);

  console.log(header);
  console.log(separator);

  for (const r of results) {
    console.log(
      padRow([
        r.fixture,
        r.strategy,
        `${(r.time / 1000).toFixed(1)}s`,
        String(r.calls),
        String(r.eventCount),
        r.accuracy != null ? r.accuracy.toFixed(1) : "-",
        r.specificity != null ? r.specificity.toFixed(1) : "-",
        r.insight != null ? r.insight.toFixed(1) : "-",
      ])
    );
  }

  console.log(separator);
}

function padRow(cols: string[]): string {
  const widths = [22, 12, 8, 7, 8, 10, 13, 10];
  return cols.map((c, i) => c.padEnd(widths[i] || 10)).join("| ");
}

function countLines(text: string): number {
  return text.split("\n").filter((l) => l.trim()).length;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
