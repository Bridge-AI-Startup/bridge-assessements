/**
 * Demo-readiness E2E orchestrator.
 *
 * Runs P1..P7 in order against the LIVE backend (must be reachable at
 * E2E_API_BASE_URL / http://localhost:5050), aggregates per-process status,
 * recommended fixes, screenshots, and unit-test results into
 * test/results/results.json (consumed by DemoReadiness.canvas.tsx), then cleans
 * up all tagged test data.
 *
 * Usage:
 *   tsx test/e2e/runAll.ts            # full run + cleanup
 *   E2E_NO_CLEANUP=true tsx ...       # keep test data for inspection
 */

import "../../src/config/loadEnv.js";

import fs from "fs/promises";
import path from "path";

import { ApiClient } from "./lib/apiClient.js";
import { API_BASE_URL } from "./lib/config.js";
import { cleanupTestData } from "./lib/cleanup.js";
import {
  EVIDENCE_DIR,
  RESULTS_DIR,
  ensureDirs,
  writeResults,
} from "./lib/evidence.js";
import { runP1Auth } from "./processes/01-auth.js";
import { runP2AssessmentLink } from "./processes/02-assessment-link.js";
import { runP3CandidateComplete } from "./processes/03-candidate-complete.js";
import { runP4DashboardUpdate } from "./processes/04-dashboard-update.js";
import { runP5VideoProcessing } from "./processes/05-video-processing.js";
import { runP6AnalysisWorkflows } from "./processes/06-analysis-workflows.js";
import { runP7TimingGuardrails } from "./processes/07-timing-guardrails.js";
import type { SuiteState } from "./lib/state.js";
import type { ProcessResult, Recommendation, SuiteResults } from "./lib/types.js";

async function waitForHealth(api: ApiClient, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await api.get("/health", 3000);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function seedExternalFixes(processes: ProcessResult[]): Recommendation[] {
  const fixes: Recommendation[] = [];
  for (const p of processes) {
    if (p.recommendation) fixes.push(p.recommendation);
  }
  // ElevenLabs voice interview cannot be fully automated (needs a live mic/agent).
  fixes.push({
    id: "p6-elevenlabs-voice",
    severity: "minor",
    process: "P6",
    issue:
      "The live ElevenLabs voice interview cannot be driven headlessly (needs a real microphone + agent session).",
    rootCause:
      "Voice interview is browser/mic-driven; only the post-call webhook path is automatable.",
    recommendedFix:
      "Verify the post-call pipeline by POSTing a signed sample payload to /webhooks/elevenlabs (see TESTING_WEBHOOK.md / test-webhook.js); for full coverage, do one manual voice run in staging.",
    files: ["server/test-webhook.js", "TESTING_WEBHOOK.md", "server/src/controllers/webhook.ts"],
    effort: "small",
  });
  return fixes;
}

async function loadUnitResults(): Promise<SuiteResults["unitTests"]> {
  const file = path.join(RESULTS_DIR, "unit-results.json");
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    return {
      ran: true,
      total: raw.numTotalTests ?? 0,
      passed: raw.numPassedTests ?? 0,
      failed: raw.numFailedTests ?? 0,
      file: "server/test/results/unit-results.json",
    };
  } catch {
    return { ran: false, total: 0, passed: 0, failed: 0, file: "server/test/results/unit-results.json" };
  }
}

async function loadScreenshots(): Promise<SuiteResults["screenshots"]> {
  const file = path.join(EVIDENCE_DIR, "screenshots.json");
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const suiteStart = Date.now();
  await ensureDirs();

  const api = new ApiClient(API_BASE_URL, null);
  console.log(`[e2e] Target backend: ${API_BASE_URL}`);

  const healthy = await waitForHealth(api);
  const state: SuiteState = { api, fixes: [], screenshots: [] };
  const processes: ProcessResult[] = [];

  if (!healthy) {
    console.error(
      `[e2e] Backend not reachable at ${API_BASE_URL}. Start it with: (cd server && npm run dev)`
    );
    processes.push({
      id: "P0",
      title: "Backend availability",
      description: "Backend must be reachable before E2E can run.",
      scriptPath: "server/test/e2e/runAll.ts",
      status: "fail",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      summary: `Backend not reachable at ${API_BASE_URL}.`,
      steps: [
        {
          name: "GET /health",
          status: "fail",
          durationMs: 0,
          detail: "No healthy response within timeout.",
          evidence: [],
        },
      ],
    });
  } else {
    const steps: Array<(s: SuiteState) => Promise<ProcessResult>> = [
      runP1Auth,
      runP2AssessmentLink,
      runP3CandidateComplete,
      runP4DashboardUpdate,
      runP5VideoProcessing,
      runP6AnalysisWorkflows,
      runP7TimingGuardrails,
    ];
    for (const step of steps) {
      const result = await step(state);
      processes.push(result);
      console.log(
        `[e2e] ${result.id} ${result.title}: ${result.status.toUpperCase()} (${result.durationMs}ms)`
      );
    }
  }

  const fixes = seedExternalFixes(processes);
  const unitTests = await loadUnitResults();
  const screenshots = await loadScreenshots();

  const results: SuiteResults = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - suiteStart,
    apiBaseUrl: API_BASE_URL,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
      OPENAI_MAX_CONCURRENT: process.env.OPENAI_MAX_CONCURRENT ?? "4",
      TRANSCRIPT_BATCH_SIZE: process.env.TRANSCRIPT_BATCH_SIZE ?? "2",
      TRANSCRIPT_BATCH_CONCURRENCY: process.env.TRANSCRIPT_BATCH_CONCURRENCY ?? "2",
      PROCTORING_STORAGE_BACKEND: process.env.PROCTORING_STORAGE_BACKEND ?? "local",
      TRANSCRIPT_INCREMENTAL_ENABLED: process.env.TRANSCRIPT_INCREMENTAL_ENABLED ?? "false",
      PROCTORING_FRAME_INTERVAL_MS: process.env.PROCTORING_FRAME_INTERVAL_MS ?? "5000",
    },
    processes,
    fixes,
    screenshots,
    unitTests,
  };

  const file = await writeResults(results);
  console.log(`[e2e] Results written: ${file}`);

  // Cleanup unless explicitly disabled.
  if (process.env.E2E_NO_CLEANUP === "true") {
    // Persist a run-context so the browser/screenshot step can log into the UI
    // as the throwaway recruiter and open the live dashboard.
    const ctx = {
      apiBaseUrl: API_BASE_URL,
      recruiter: state.recruiter
        ? {
            email: state.recruiter.email,
            password: state.recruiter.password,
            companyName: state.recruiter.companyName,
          }
        : null,
      assessmentId: state.assessmentId ?? null,
      candidate: state.candidate ?? null,
    };
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "run-context.json"),
      JSON.stringify(ctx, null, 2),
      "utf-8"
    );
    console.log(
      "[e2e] E2E_NO_CLEANUP=true -> skipping cleanup (test data retained); wrote evidence/run-context.json."
    );
  } else {
    try {
      const emails = state.recruiter ? [state.recruiter.email] : [];
      const report = await cleanupTestData(emails);
      console.log(`[e2e] Cleanup: ${JSON.stringify(report)}`);
    } catch (err) {
      console.warn("[e2e] Cleanup failed (non-fatal):", err);
    }
  }

  // Summary line.
  const pass = processes.filter((p) => p.status === "pass").length;
  const fail = processes.filter((p) => p.status === "fail").length;
  const blocked = processes.filter((p) => p.status === "blocked").length;
  console.log(
    `[e2e] DONE: ${pass} pass / ${fail} fail / ${blocked} blocked of ${processes.length} processes; ${fixes.length} recommended fixes.`
  );

  try {
    await (await import("mongoose")).default.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[e2e] Fatal:", err);
  process.exit(1);
});
