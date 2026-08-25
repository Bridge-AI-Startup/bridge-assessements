/**
 * Companion director — one-shot dev runner. This is the prompt-iteration tool:
 * do real work in a captured session, then run this repeatedly and read the
 * decisions, no voice stack needed.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/companionDirectorTick.ts --submission <submissionId> [--dry-run] [--show-context]
 *   npx tsx src/scripts/companionDirectorTick.ts --session <proctoringSessionId> [--dry-run]
 *
 * --dry-run       call the model but persist nothing (no briefing published)
 * --show-context  also print the context bundle the model saw
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import { runDirectorForSession } from "../services/companion/director.js";
import { buildContextBundle } from "../services/agentContext/contextCenter.js";
import { getDirectorModel } from "../services/companion/directorModel.js";

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const submissionId = getArg("--submission");
  const sessionArg = getArg("--session");
  const dryRun = process.argv.includes("--dry-run");
  const showContext = process.argv.includes("--show-context");

  if (!submissionId && !sessionArg) {
    console.error(
      "Usage: npx tsx src/scripts/companionDirectorTick.ts --submission <id> [--dry-run] [--show-context]"
    );
    process.exit(1);
  }

  await connectMongoose();

  let proctoringSessionId = sessionArg;
  let resolvedSubmissionId = submissionId;
  if (!proctoringSessionId && submissionId) {
    const session = await ProctoringSessionModel.findOne({ submissionId })
      .select("_id companion")
      .lean();
    if (!session) {
      console.error(`No proctoring session found for submission ${submissionId}`);
      process.exit(1);
    }
    proctoringSessionId = String(session._id);
    console.log(
      `Proctoring session ${proctoringSessionId} (companion: ${(session.companion as any)?.status ?? "not_started"})`
    );
  } else if (proctoringSessionId && !resolvedSubmissionId) {
    const session = await ProctoringSessionModel.findById(proctoringSessionId)
      .select("submissionId")
      .lean();
    resolvedSubmissionId = session ? String(session.submissionId) : null;
  }

  if (showContext && resolvedSubmissionId) {
    const bundle = await buildContextBundle(resolvedSubmissionId, {
      topics: ["assessment", "timeline", "conversation"],
    });
    console.log("\n===== context bundle =====");
    console.log(JSON.stringify(bundle, null, 2));
  }

  console.log(
    `\nRunning director (model ${getDirectorModel()}, dryRun=${dryRun})…`
  );
  const started = Date.now();
  const result = await runDirectorForSession(String(proctoringSessionId), {
    dryRun,
  });
  console.log(`\n===== result (${Date.now() - started}ms) =====`);
  console.log(`outcome: ${result.outcome}`);
  if (result.decision) {
    console.log(JSON.stringify(result.decision, null, 2));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
