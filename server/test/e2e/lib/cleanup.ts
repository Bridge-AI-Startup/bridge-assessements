/**
 * Tear down everything the suite created. Keyed by the test email domain so it
 * is safe to run repeatedly and never touches real customer data. Operates
 * directly on Mongo + Firebase Admin so it works even if a process failed
 * mid-run (i.e. does not depend on the HTTP server being up).
 */

import "../../../src/config/loadEnv.js";

import connectMongoose from "../../../src/db/mongooseConnection.js";
import AssessmentModel from "../../../src/models/assessment.js";
import ProctoringSessionModel from "../../../src/models/proctoringSession.js";
import RepoIndexModel from "../../../src/models/repoIndex.js";
import SubmissionModel from "../../../src/models/submission.js";
import UserModel from "../../../src/models/user.js";
import { TEST_EMAIL_DOMAIN } from "./config.js";

export interface CleanupReport {
  users: number;
  assessments: number;
  submissions: number;
  proctoringSessions: number;
  repoIndexes: number;
  firebaseDeleted: number;
}

export async function cleanupTestData(extraEmails: string[] = []): Promise<CleanupReport> {
  await connectMongoose();

  const report: CleanupReport = {
    users: 0,
    assessments: 0,
    submissions: 0,
    proctoringSessions: 0,
    repoIndexes: 0,
    firebaseDeleted: 0,
  };

  const emailFilter = {
    $or: [
      { email: { $regex: new RegExp(`@${escapeRegex(TEST_EMAIL_DOMAIN)}$`, "i") } },
      ...(extraEmails.length ? [{ email: { $in: extraEmails } }] : []),
    ],
  };

  const users = await UserModel.find(emailFilter);
  for (const user of users) {
    const assessments = await AssessmentModel.find({ userId: user._id });
    for (const assessment of assessments) {
      const submissions = await SubmissionModel.find({
        assessmentId: assessment._id,
      });
      for (const submission of submissions) {
        const sessRes = await ProctoringSessionModel.deleteMany({
          submissionId: submission._id,
        });
        report.proctoringSessions += sessRes.deletedCount || 0;
        const riRes = await RepoIndexModel.deleteMany({
          submissionId: submission._id,
        });
        report.repoIndexes += riRes.deletedCount || 0;
      }
      const subRes = await SubmissionModel.deleteMany({
        assessmentId: assessment._id,
      });
      report.submissions += subRes.deletedCount || 0;
      await AssessmentModel.deleteOne({ _id: assessment._id });
      report.assessments += 1;
    }

    // Best-effort Firebase user deletion.
    try {
      const { firebaseAdminAuth } = await import("../../../src/utils/firebase.js");
      await firebaseAdminAuth.deleteUser(user.firebaseUid);
      report.firebaseDeleted += 1;
    } catch {
      /* user may already be gone */
    }

    await UserModel.deleteOne({ _id: user._id });
    report.users += 1;
  }

  return report;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Allow running standalone: `tsx test/e2e/lib/cleanup.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestData(process.argv.slice(2))
    .then((r) => {
      console.log("[cleanup] done:", JSON.stringify(r));
      return import("mongoose").then((m) => m.default.connection.close());
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[cleanup] failed:", e);
      process.exit(1);
    });
}
