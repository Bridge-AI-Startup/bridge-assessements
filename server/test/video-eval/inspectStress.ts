/** Temp: print criteria_results for the stress assessment submissions. */
import "../../src/config/loadEnv.js";
import connectMongoose from "../../src/db/mongooseConnection.js";
import AssessmentModel from "../../src/models/assessment.js";
import SubmissionModel from "../../src/models/submission.js";
import UserModel from "../../src/models/user.js";

const TITLE = "Resilient Webhook Dispatcher — Live Coding Sessions (30+ min stress set)";

async function main() {
  await connectMongoose();
  const user = await UserModel.findOne({ email: "demo@bridgeai-demo.com" });
  const a = await AssessmentModel.findOne({ userId: user!._id, title: TITLE });
  console.log("assessment:", a?._id?.toString());
  const subs = await SubmissionModel.find({ assessmentId: a!._id }).lean();
  const ProctoringSessionModel = (await import("../../src/models/proctoringSession.js")).default;
  for (const s of subs as any[]) {
    console.log(`\n===== ${s.candidateName} (${s.candidateEmail}) =====`);
    console.log("overall:", s.scores?.overall, "evalStatus:", s.evaluationStatus);
    const sess = await ProctoringSessionModel.findOne({ submissionId: s._id }).lean();
    console.log(
      "  session.transcript.status:",
      (sess as any)?.transcript?.status,
      "frameCount:",
      (sess as any)?.transcript?.frameCount,
      "storageKey:",
      (sess as any)?.transcript?.storageKey
    );
    const rep = s.evaluationReport;
    if (!rep) {
      console.log("  (no evaluationReport)");
      continue;
    }
    for (const r of rep.criteria_results ?? []) {
      console.log(
        `  [score ${r.score} evaluable=${r.evaluable} conf=${r.confidence}] ${r.criterion.slice(0, 64)}`
      );
      console.log(`     verdict: ${(r.verdict ?? "").slice(0, 200)}`);
      if (r.evidence?.[0]) console.log(`     evidence: ${(r.evidence[0].observation ?? "").slice(0, 160)}`);
    }
    console.log("  summary:", (rep.session_summary ?? "").slice(0, 300));
  }
  const mongoose = (await import("mongoose")).default;
  await mongoose.connection.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
