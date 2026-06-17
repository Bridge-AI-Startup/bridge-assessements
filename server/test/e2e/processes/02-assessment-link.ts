/**
 * P2 - Assessment creation + candidate link.
 * Proves: a company can create an assessment and mint a candidate share link
 * whose token resolves from any origin with no auth/cookies ("works on any URL").
 */

import { expectOk } from "../lib/apiClient.js";
import { BUDGETS } from "../lib/config.js";
import { runProcess } from "../lib/runner.js";
import { seedRecruiterAssessmentSubmission } from "../lib/seed.js";
import { authedApi, type SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

const RUN_ASSESSMENT_GEN = process.env.E2E_RUN_ASSESSMENT_GEN === "true";

export function runP2AssessmentLink(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P2",
      title: "Assessment + Candidate Link",
      description:
        "Create an assessment and generate a tokenized candidate link that resolves without authentication from any URL.",
      scriptPath: "server/test/e2e/processes/02-assessment-link.ts",
    },
    async (ctx) => {
      if (!state.recruiter) {
        ctx.skip("All steps", "Skipped: P1 did not produce a recruiter token");
        return;
      }

      // Attempt the genuine authenticated employer path first. If the backend
      // cannot verify the token / look up the user (Firebase Admin credential
      // broken in this env), fall back to seeding the assessment + submission
      // directly so the rest of the pipeline still produces real evidence.
      const created = await ctx.attempt(
        "Create assessment (POST /api/assessments)",
        async (ev) => {
          const payload = {
            title: `E2E Backend Assessment ${Date.now()}`,
            description:
              "Build a small REST endpoint that sums a list of integers and returns JSON.",
            timeLimit: 60,
            evaluationCriteria: ["Iterative test-driven progress is visible"],
            behavioralChecks: ["The endpoint returns correct JSON for a valid list"],
          };
          const res = await authedApi(state).post(
            "/api/assessments",
            payload,
            BUDGETS.apiCall
          );
          const out = expectOk(res, "create assessment");
          ev.json("assessmentId", out._id);
          return out;
        }
      );

      let link: any = null;
      if (created) {
        state.assessmentId = created._id;
        link = await ctx.attempt(
          "Generate candidate link (POST /api/submissions/generate-link)",
          async (ev) => {
            const res = await authedApi(state).post(
              "/api/submissions/generate-link",
              {
                assessmentId: created._id,
                candidateName: "E2E Candidate",
                candidateEmail: `e2e+candidate.${Date.now()}@bridge-e2e.test`,
              }
            );
            const out = expectOk(res, "generate link");
            ev.json("token", out.token);
            ev.json("shareLink", out.shareLink);
            ev.json("submissionId", out.submissionId);
            return out;
          }
        );
        if (link) {
          state.candidate = {
            token: link.token,
            submissionId: link.submissionId,
            shareLink: link.shareLink,
          };
        }
      }

      const apiPathWorked = Boolean(created && link);
      if (!apiPathWorked) {
        const seeded = await ctx.step(
          "Seed assessment + candidate submission (fallback, direct service)",
          async (ev) => {
            const s = await seedRecruiterAssessmentSubmission({
              firebaseUid: state.recruiter!.uid,
              email: state.recruiter!.email,
              companyName: state.recruiter!.companyName,
            });
            ev.json("assessmentId", s.assessmentId);
            ev.json("submissionId", s.submissionId);
            ev.json("shareLink", s.shareLink);
            ev.json(
              "note",
              "Authenticated employer API is blocked by the Firebase Admin credential (P1). Created via the same Mongoose models the controllers use; only Firebase auth is bypassed so the link mechanism can be verified."
            );
            return s;
          }
        );
        state.assessmentId = seeded.assessmentId;
        state.candidate = {
          token: seeded.token,
          submissionId: seeded.submissionId,
          shareLink: seeded.shareLink,
        };
      }

      if (RUN_ASSESSMENT_GEN && apiPathWorked) {
        await ctx.step(
          "AI generation (POST /api/assessments/generate)",
          async (ev) => {
            const res = await authedApi(state).post(
              "/api/assessments/generate",
              {
                description:
                  "Senior backend engineer take-home: implement a rate-limited REST API in Node.",
                level: "senior",
                stack: "backend-node",
              },
              BUDGETS.assessmentGen
            );
            const gen = expectOk(res, "generate assessment");
            ev.json("generatedTitle", gen.title || gen?.assessment?.title);
          },
          BUDGETS.assessmentGen
        );
      } else {
        ctx.skip(
          "AI generation (POST /api/assessments/generate)",
          apiPathWorked
            ? "Skipped by default (LLM cost/time). Enable with E2E_RUN_ASSESSMENT_GEN=true."
            : "Skipped: authenticated API path unavailable in this environment."
        );
      }

      await ctx.step(
        "Link resolves with NO auth (GET /api/submissions/token/:token)",
        async (ev) => {
          // Deliberately use the unauthenticated client to prove the link works
          // from any origin without cookies/headers.
          const res = await state.api.get(
            `/api/submissions/token/${state.candidate!.token}`
          );
          const sub = expectOk(res, "resolve token");
          ev.json("resolvedStatus", sub.status);
          ev.json("candidateName", sub.candidateName);
          ev.json(
            "note",
            "Resolved using an unauthenticated client -> link is portable to any URL."
          );
          if (sub.status !== "pending") {
            throw new Error(`expected pending submission, got ${sub.status}`);
          }
        }
      );

      await ctx.step(
        "Public assessment fetch (GET /assessments/public/:id)",
        async (ev) => {
          const res = await state.api.get(
            `/api/submissions/assessments/public/${state.assessmentId}`
          );
          const pub = expectOk(res, "public assessment");
          ev.json("title", pub.title);
          ev.json("timeLimit", pub.timeLimit);
        }
      );

      // Email invites require Resend, which is not configured in this env.
      ctx.blocked(
        "Email invites (POST /api/submissions/send-invites)",
        "RESEND_API_KEY is not configured, so invitation emails cannot be sent/verified live."
      );
      ctx.recommend({
        id: "p2-resend",
        severity: "minor",
        issue:
          "Candidate invitation emails cannot be exercised end-to-end in this environment.",
        rootCause: "RESEND_API_KEY is absent from server/config.env.",
        recommendedFix:
          "Add a RESEND_API_KEY to server/config.env (and Render env) and re-run P2 with the send-invites step enabled.",
        files: ["server/config.env", "server/src/services/email.ts"],
        effort: "small",
      });

      ctx.summary(
        "Assessment created and a tokenized candidate link generated; the link resolves with no auth (portable to any URL). Email invites are blocked (no Resend key)."
      );
    }
  );
}
