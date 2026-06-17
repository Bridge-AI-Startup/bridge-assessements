/**
 * P7 - Timing / terminal-jam guardrails.
 * Proves the protections that keep the suite (and the demo) responsive:
 *  - every long op is wrapped in a hard timeout (no infinite hangs),
 *  - the API client aborts hung requests,
 *  - a 30-minute recording is rejected from inline analysis (must go async),
 *  - the backend runs as a separate (backgrounded) process and stays responsive.
 */

import { runProcess, withTimeout } from "../lib/runner.js";
import {
  assertInlineProcessable,
  estimateFrameCount,
  isInlineProcessable,
} from "../lib/guards.js";
import { FIXTURES } from "../lib/config.js";
import type { SuiteState } from "../lib/state.js";
import type { ProcessResult } from "../lib/types.js";

export function runP7TimingGuardrails(state: SuiteState): Promise<ProcessResult> {
  return runProcess(
    {
      id: "P7",
      title: "Timing / Jam Guardrails",
      description:
        "Hard timeouts, request aborts, large-input rejection, and a responsive backgrounded server.",
      scriptPath: "server/test/e2e/processes/07-timing-guardrails.ts",
    },
    async (ctx) => {
      await ctx.step("Hard timeout aborts a hung operation", async (ev) => {
        const start = Date.now();
        let timedOut = false;
        try {
          await withTimeout(
            new Promise(() => {
              /* never resolves */
            }),
            200,
            "never-resolving op"
          );
        } catch (err: any) {
          timedOut = /budget/.test(err?.message || "");
        }
        const elapsed = Date.now() - start;
        ev.json("timedOut", timedOut);
        ev.json("elapsedMs", elapsed);
        if (!timedOut || elapsed > 1500) {
          throw new Error("withTimeout did not abort the hung op promptly");
        }
      });

      await ctx.step("API client never hangs (bounded completion)", async (ev) => {
        // A 1ms budget either aborts (AbortError -> budget message) or the local
        // request wins the race and completes. Either way it must NOT hang. The
        // deterministic abort behavior is proven in test/unit/lib/apiClient.test.ts.
        const start = Date.now();
        let aborted = false;
        let completed = false;
        try {
          await state.api.get("/health", 1);
          completed = true;
        } catch (err: any) {
          aborted = /budget|aborted/i.test(err?.message || "");
          if (!aborted) throw err;
        }
        const elapsed = Date.now() - start;
        ev.json("aborted", aborted);
        ev.json("completed", completed);
        ev.json("elapsedMs", elapsed);
        ev.text("deterministicAbortProof", "server/test/unit/lib/apiClient.test.ts");
        if (elapsed > 1000) {
          throw new Error(`bounded request took ${elapsed}ms (possible hang)`);
        }
      });

      await ctx.step(
        "30-minute recording is rejected from inline analysis",
        async (ev) => {
          const thirtyMinFrames = estimateFrameCount(30 * 60);
          const shortClipFrames = estimateFrameCount(
            FIXTURES.realRecordingSeconds
          );
          ev.json("thirtyMinuteFrames", thirtyMinFrames);
          ev.json("maxInlineFrames", FIXTURES.maxInlineFrames);
          ev.json("shortClipFrames", shortClipFrames);
          ev.json(
            "shortClipInlineProcessable",
            isInlineProcessable(shortClipFrames)
          );

          let rejected = false;
          try {
            assertInlineProcessable(thirtyMinFrames);
          } catch {
            rejected = true;
          }
          ev.json("thirtyMinuteRejected", rejected);
          if (!rejected) {
            throw new Error(
              "guard failed to reject a 30-minute recording from inline analysis"
            );
          }
          if (!isInlineProcessable(shortClipFrames)) {
            throw new Error("short clip should be inline-processable");
          }
          ev.json(
            "note",
            "Long recordings must use the incremental sliding-window scheduler (TRANSCRIPT_INCREMENTAL_ENABLED) instead of one synchronous pass."
          );
        }
      );

      await ctx.step("Backend is responsive and backgrounded", async (ev) => {
        const start = Date.now();
        const res = await state.api.get("/health", 5000);
        const elapsed = Date.now() - start;
        ev.json("healthStatus", res.status);
        ev.json("healthMs", elapsed);
        ev.json(
          "note",
          "The suite always starts the server as a separate background process; it never blocks the test process on a long server task."
        );
        if (!res.ok) throw new Error(`/health returned ${res.status}`);
      });

      ctx.summary(
        "All long ops are time-bounded, hung requests abort, a 30-minute recording is rejected from inline analysis (forcing async), and the backgrounded server stays responsive."
      );
    }
  );
}
