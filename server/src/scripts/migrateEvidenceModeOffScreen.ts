/**
 * Migrate assessments off the removed "screen" evidence mode.
 *
 * Correctness does not depend on this: `resolveEvidenceMode` already treats a
 * missing field and the unrecognised string "screen" the same way — both become
 * "both" — so every legacy assessment reads correctly the moment the code
 * ships. What this fixes is the *stored* data:
 *
 *  - A document still holding "screen" now violates the Assessment schema enum.
 *    Reading is fine; the next save of that document (an employer editing the
 *    title, say) fails validation. That is the one real breakage, and it is why
 *    this should be run.
 *  - Documents with no field at all are stamped so the mode is explicit rather
 *    than implied by a default that has now changed once already.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx --env-file=config.env src/scripts/migrateEvidenceModeOffScreen.ts
 *   npx tsx --env-file=config.env src/scripts/migrateEvidenceModeOffScreen.ts --apply
 */
import "../config/loadEnv.js";
import mongoose from "mongoose";

import AssessmentModel from "../models/assessment.js";

const APPLY = process.argv.includes("--apply");
const TARGET = "both" as const;

async function main(): Promise<void> {
  const uri = process.env.ATLAS_URI;
  if (!uri) throw new Error("ATLAS_URI is not set");
  await mongoose.connect(uri, { dbName: process.env.DB_NAME });

  // `$nin` also sweeps up any other unrecognised value, which reads as "both"
  // anyway — leaving it stored would be the same latent save failure.
  const filter = {
    $or: [
      { evidenceMode: { $exists: false } },
      { evidenceMode: null },
      { evidenceMode: { $nin: ["none", "workflow", "both"] } },
    ],
  };

  const affected = await AssessmentModel.find(filter)
    .select("_id title evidenceMode")
    .lean();

  const absent = affected.filter((a: any) => a.evidenceMode == null).length;
  const explicit = affected.length - absent;

  console.log(
    `\n${affected.length} assessment(s) to migrate → "${TARGET}"\n` +
      `  ${absent} with no evidenceMode field\n` +
      `  ${explicit} holding a removed/unrecognised value (e.g. "screen")\n`
  );
  for (const a of affected as any[]) {
    console.log(
      `  ${a._id}  ${String(a.evidenceMode ?? "(absent)").padEnd(12)}  ${String(a.title ?? "").slice(0, 60)}`
    );
  }

  if (affected.length === 0) {
    console.log("\nNothing to do.");
  } else if (!APPLY) {
    console.log(
      `\nDRY RUN — nothing written. Re-run with --apply to set evidenceMode="${TARGET}" on the ${affected.length} document(s) above.`
    );
  } else {
    // updateMany, not save(): these documents are exactly the ones that would
    // fail the new schema enum on a full-document validate.
    const res = await AssessmentModel.updateMany(filter, {
      $set: { evidenceMode: TARGET },
    });
    console.log(`\nAPPLIED — ${res.modifiedCount} document(s) updated.`);
    const left = await AssessmentModel.countDocuments(filter);
    console.log(
      left === 0
        ? "Verified: no assessments remain on a removed or absent mode."
        : `WARNING: ${left} document(s) still match the filter.`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[migrate-evidence-mode] failed:", err);
  process.exit(1);
});
