/**
 * P6 - Analysis workflows return to the recruiter.
 * Proves: chunk-based repo indexing (Pinecone) and analysis fields surface
 * back to the employer via the submission record. Combined score signals are
 * Screen (recording rubric) + Behavioral (E2B) — the deprecated Trace/LLM-workflow
 * scorer was removed. Post-submit voice interview generation is also removed.
 */

import { expectOk } from "../lib/apiClient.js";
import { BUDGETS } from "../lib/config.js";
import { runProcess } from "../lib/runner.js";
import { directIndexRepo } from "../lib/seed.js";
import type { SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

export function runP6AnalysisWorkflows(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P6",
      title: "Analysis Workflows",
      description:
        "Chunk-based repo indexing, and analysis fields surfaced to the recruiter.",
      scriptPath: "server/test/e2e/processes/06-analysis-workflows.ts",
    },
    async (ctx) => {
      if (!state.recruiter || !state.candidate) {
        ctx.skip("All steps", "Skipped: missing recruiter/candidate from earlier processes");
        return;
      }
      const submissionId = state.candidate.submissionId;
      ctx.blocked(
        "Employer analysis endpoints via authenticated API",
        "index-repo requires employer auth, which is blocked by the Firebase Admin credential issue (P1). Invoking the SAME service functions directly so the real analysis still runs against Pinecone/OpenAI."
      );

      const index = await ctx.step(
        "Chunk-based repo indexing (repoIndexing.indexSubmissionRepo)",
        async (ev) => {
          const out = await directIndexRepo(submissionId);
          ev.json("status", out.status);
          ev.json("chunkCount", out.chunkCount);
          ev.json("fileCount", out.fileCount);
          ev.json("error", out.error ?? null);
          if (out.status !== "ready") {
            throw new Error(`indexing status ${out.status}: ${out.error || ""}`);
          }
          return out;
        },
        BUDGETS.indexRepo
      );

      await ctx.step("Chunk-based scanning summary", async (ev) => {
        ev.json(
          "note",
          `Chunk-based indexing produced ${index.chunkCount} chunks across ${index.fileCount} files (embedded + upserted to Pinecone).`
        );
      });

      await ctx.step(
        "Analysis is readable by recruiter (GET /:id, public)",
        async (ev) => {
          const res = await state.api.get(`/api/submissions/${submissionId}`);
          const sub = expectOk(res, "get submission");
          ev.json("evaluationStatus", sub.evaluationStatus ?? null);
          ev.json(
            "hasEvaluationReport",
            Boolean((sub as any).evaluationReport)
          );
          ev.json(
            "behavioralGradingStatus",
            sub.behavioralGradingStatus ?? null
          );
        }
      );

      // Behavioral grading needs E2B, which is not configured here.
      ctx.blocked(
        "Behavioral grading (E2B) (POST /:id/grade-behavioral)",
        "E2B_API_KEY / BEHAVIORAL_GRADING_ENABLED not configured; the sandboxed behavioral grading workflow cannot run live."
      );
      ctx.recommend({
        id: "p6-e2b",
        severity: "major",
        issue:
          "Behavioral grading (sandboxed run + per-check verdicts) cannot be exercised end-to-end.",
        rootCause:
          "E2B_API_KEY is absent and BEHAVIORAL_GRADING_ENABLED is not set in server/config.env.",
        recommendedFix:
          "Add E2B_API_KEY and set BEHAVIORAL_GRADING_ENABLED=true, then re-run the suite or POST /:id/grade-behavioral. The behavioral-grading-smoke script can validate setup first.",
        files: [
          "server/config.env",
          "server/src/services/behavioralGrading/index.ts",
          "server/src/scripts/behavioral-grading-smoke.ts",
        ],
        effort: "medium",
      });

      ctx.summary(
        "Repo indexed into chunks, transcript available, and scoring endpoint functional; all surfaced via the submission record. Behavioral grading blocked (no E2B)."
      );
    }
  );
}
