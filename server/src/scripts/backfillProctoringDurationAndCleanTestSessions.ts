/**
 * 1) Backfill stats.videoStats.durationSeconds for existing proctoring sessions
 *    that have videoChunks but no duration (or 0), by summing chunk (endTime - startTime).
 * 2) Delete "testing" sessions: those whose submission is not linked to a real assessment
 *    (assessmentId not in Assessment collection) or has candidateEmail "proctoring-test@test.com".
 *    Also removes their storage directories under PROCTORING_STORAGE_DIR.
 *
 * Usage (from server directory):
 *   npx tsx src/scripts/backfillProctoringDurationAndCleanTestSessions.ts
 *
 * Env: config.env (or ATLAS_URI, PROCTORING_STORAGE_DIR) must be loaded.
 */

import "../config/loadEnv.js";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";

const TEST_CANDIDATE_EMAIL = "proctoring-test@test.com";

async function main() {
  const baseDir =
    process.env.PROCTORING_STORAGE_DIR ||
    path.join(process.cwd(), "storage", "proctoring");

  try {
    await connectMongoose();

    const sessions = await ProctoringSessionModel.find({}).lean();
    if (sessions.length === 0) {
      console.log("No proctoring sessions found.");
      await mongoose.disconnect();
      process.exit(0);
    }

    const submissionIds = [...new Set(sessions.map((s: any) => s.submissionId?.toString()).filter(Boolean))];
    const submissions = await SubmissionModel.find({ _id: { $in: submissionIds } })
      .lean()
      .select("_id assessmentId candidateEmail");

    const assessmentIds = [...new Set(submissions.map((s: any) => s.assessmentId?.toString()).filter(Boolean))];
    const existingAssessmentIds = new Set(
      (await AssessmentModel.find({ _id: { $in: assessmentIds } }).lean().select("_id")).map((a: any) => a._id.toString())
    );

    const isTestSubmission = (sub: any) => {
      if (!sub) return true;
      if (sub.candidateEmail === TEST_CANDIDATE_EMAIL) return true;
      if (!sub.assessmentId || !existingAssessmentIds.has(sub.assessmentId.toString())) return true;
      return false;
    };

    const submissionMap = new Map(submissions.map((s: any) => [s._id.toString(), s]));
    const testSessionIds: string[] = [];
    const realSessions: any[] = [];

    for (const s of sessions as any[]) {
      const subId = s.submissionId?.toString();
      const sub = subId ? submissionMap.get(subId) : null;
      if (isTestSubmission(sub)) {
        testSessionIds.push(s._id.toString());
      } else {
        realSessions.push(s);
      }
    }

    // Delete test sessions from DB and storage
    if (testSessionIds.length > 0) {
      const deleteResult = await ProctoringSessionModel.deleteMany({ _id: { $in: testSessionIds } });
      console.log(`Deleted ${deleteResult.deletedCount} test proctoring session(s) from DB.`);

      for (const sessionId of testSessionIds) {
        const dir = path.join(baseDir, sessionId);
        try {
          await fs.rm(dir, { recursive: true, force: true });
          console.log(`  Removed storage: ${sessionId}`);
        } catch (e) {
          // Dir may not exist
        }
      }
    } else {
      console.log("No test sessions to delete.");
    }

    // Backfill durationSeconds for real sessions that have videoChunks but no duration
    let backfilled = 0;
    for (const session of realSessions as any[]) {
      const chunks = session.videoChunks;
      if (!chunks || chunks.length === 0) continue;

      const current = session.stats?.videoStats?.durationSeconds;
      if (current != null && current > 0) continue;

      let totalSec = 0;
      for (const ch of chunks) {
        const start = ch.startTime ? new Date(ch.startTime).getTime() : NaN;
        const end = (ch.endTime ? new Date(ch.endTime) : ch.startTime ? new Date(ch.startTime) : null)?.getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          totalSec += (end - start) / 1000;
        }
      }

      if (totalSec > 0) {
        await ProctoringSessionModel.findByIdAndUpdate(session._id, {
          $set: { "stats.videoStats.durationSeconds": totalSec },
        });
        backfilled++;
      }
    }

    console.log(`Backfilled durationSeconds for ${backfilled} session(s).`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
