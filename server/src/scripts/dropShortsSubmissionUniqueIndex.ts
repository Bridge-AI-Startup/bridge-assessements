/**
 * Drop the legacy unique index on PlaySubmission {anonymousId, challengeDate}.
 *
 * Submissions used to be one-per-builder-per-challenge, enforced by a unique
 * index, and submitting again overwrote the previous build. Submissions are now
 * independent entries, but Mongoose never drops indexes that disappear from a
 * schema — the old unique index survives in Atlas and would reject the second
 * insert with E11000. This script removes it. Safe to re-run.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/dropShortsSubmissionUniqueIndex.ts
 *   npx tsx --env-file=config.env src/scripts/dropShortsSubmissionUniqueIndex.ts --dry-run
 */

import "../config/loadEnv.js";
import type { Connection } from "mongoose";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlaySubmissionModel } from "../models/shorts/submission.js";

let connection: Connection | null = null;

const LEGACY_KEY = { anonymousId: 1, challengeDate: 1 };

function isLegacyUniqueIndex(index: {
  key: Record<string, unknown>;
  unique?: boolean;
}): boolean {
  if (!index.unique) return false;
  const keys = Object.keys(index.key);
  if (keys.length !== Object.keys(LEGACY_KEY).length) return false;
  return keys.every(
    (k) =>
      k in LEGACY_KEY &&
      index.key[k] === LEGACY_KEY[k as keyof typeof LEGACY_KEY],
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  connection = await connectPlayMongoose();
  const Submission = getPlaySubmissionModel();
  const collection = Submission.collection;

  const indexes = (await collection.indexes()) as Array<{
    name: string;
    key: Record<string, unknown>;
    unique?: boolean;
  }>;

  console.log(`Collection: ${collection.collectionName}`);
  for (const idx of indexes) {
    console.log(
      `  ${idx.name}  ${JSON.stringify(idx.key)}${idx.unique ? "  UNIQUE" : ""}`,
    );
  }

  const legacy = indexes.filter(isLegacyUniqueIndex);
  if (legacy.length === 0) {
    console.log("\nNo legacy unique index found — nothing to do.");
    await connection.close();
    return;
  }

  for (const idx of legacy) {
    if (dryRun) {
      console.log(`\n[dry-run] would drop index: ${idx.name}`);
      continue;
    }
    await collection.dropIndex(idx.name);
    console.log(`\nDropped index: ${idx.name}`);
  }

  if (!dryRun) {
    // createIndexes (not syncIndexes) — only adds the replacement lookup index;
    // it will not drop anything else that exists in Atlas.
    await Submission.createIndexes();
    console.log("Created current schema indexes.");
  }

  await connection.close();
}

main().catch(async (err) => {
  console.error(err);
  await connection?.close().catch(() => {});
  process.exit(1);
});
