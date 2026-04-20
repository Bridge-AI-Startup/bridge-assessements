/**
 * Create or update the single public Competition document (links slug → assessment).
 *
 * Usage (from server/):
 *   npx tsx src/scripts/seedCompetition.ts <assessmentMongoId>
 *   npx tsx src/scripts/seedCompetition.ts <assessmentMongoId> my-slug
 *
 * Defaults slug to "the-challenge" (assessment "The Challenge"; match client/src/config/competition.js
 * unless you override with VITE_DEFAULT_COMPETITION_SLUG or ?slug=).
 */

import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import CompetitionModel from "../models/competition.js";
import AssessmentModel from "../models/assessment.js";

const DEFAULT_SLUG = "the-challenge";

async function main() {
  const assessmentId = process.argv[2];
  const slugArg = process.argv[3]?.trim().toLowerCase();
  const slug = slugArg || DEFAULT_SLUG;

  if (!assessmentId || !mongoose.isValidObjectId(assessmentId)) {
    console.error(
      "Usage: npx tsx src/scripts/seedCompetition.ts <assessmentId> [slug]\n" +
        `  Example: npx tsx src/scripts/seedCompetition.ts <assessmentId> ${DEFAULT_SLUG}`,
    );
    process.exit(1);
  }

  await connectMongoose();

  const assessment = await AssessmentModel.findById(assessmentId).lean();
  if (!assessment) {
    console.error("Assessment not found:", assessmentId);
    process.exit(1);
  }

  const doc = await CompetitionModel.findOneAndUpdate(
    { slug },
    {
      $set: {
        assessmentId,
        title: assessment.title,
        description: assessment.description,
        registrationOpen: true,
        leaderboardPublic: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  console.log("Competition saved:");
  console.log("  slug:", doc.slug);
  console.log("  assessmentId:", String(doc.assessmentId));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
