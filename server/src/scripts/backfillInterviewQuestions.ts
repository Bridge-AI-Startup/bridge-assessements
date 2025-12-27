/**
 * One-time migration script to convert interviewQuestions from string[] to object[]
 *
 * This script:
 * - Finds submissions where interviewQuestions is still stored as an array of strings
 * - Converts each string to { prompt: string, anchors: [], createdAt: Date }
 * - Saves the updated submission
 *
 * Run this once after deploying the schema change:
 *   npx tsx src/scripts/backfillInterviewQuestions.ts
 *
 * Or with ts-node:
 *   npx ts-node --esm src/scripts/backfillInterviewQuestions.ts
 */

import mongoose from "mongoose";
import SubmissionModel from "../models/submission.js";
import connectMongoose from "../db/mongooseConnection.js";

async function backfillInterviewQuestions() {
  try {
    console.log("🔄 Connecting to database...");
    await connectMongoose();
    console.log("✅ Connected to database");

    // Find all submissions with interviewQuestions
    const submissions = await SubmissionModel.find({
      interviewQuestions: { $exists: true, $ne: [] },
    });

    console.log(`📋 Found ${submissions.length} submissions to check`);

    let convertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const submission of submissions) {
      try {
        // Check if interviewQuestions is an array of strings (old format)
        if (
          Array.isArray(submission.interviewQuestions) &&
          submission.interviewQuestions.length > 0
        ) {
          const firstQuestion = submission.interviewQuestions[0];

          // Check if it's a string (old format) or if it's already an object without prompt property
          const isOldFormat =
            typeof firstQuestion === "string" ||
            (typeof firstQuestion === "object" &&
              firstQuestion !== null &&
              !("prompt" in firstQuestion));

          if (isOldFormat) {
            // Convert to new format
            const convertedQuestions = submission.interviewQuestions.map(
              (q: any) => {
                // If it's already an object but missing prompt, use the whole thing as prompt
                if (typeof q === "object" && q !== null) {
                  return {
                    prompt: String(q),
                    anchors: [],
                    createdAt: q.createdAt || new Date(),
                  };
                }
                // If it's a string, convert it
                return {
                  prompt: String(q),
                  anchors: [],
                  createdAt: new Date(),
                };
              }
            );

            submission.interviewQuestions = convertedQuestions;
            submission.markModified("interviewQuestions");
            await submission.save();

            console.log(
              `✅ Converted submission ${submission._id}: ${convertedQuestions.length} questions`
            );
            convertedCount++;
          } else {
            // Already in new format
            skippedCount++;
          }
        } else {
          // Empty or doesn't exist
          skippedCount++;
        }
      } catch (error) {
        console.error(
          `❌ Error processing submission ${submission._id}:`,
          error
        );
        errorCount++;
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`   ✅ Converted: ${convertedCount}`);
    console.log(`   ⏭️  Skipped (already new format): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📋 Total processed: ${submissions.length}`);

    console.log("\n✅ Backfill completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error during backfill:", error);
    process.exit(1);
  }
}

// Run the backfill
backfillInterviewQuestions();
