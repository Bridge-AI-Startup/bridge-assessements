/**
 * One-off: set an explicit live window on a Shorts challenge so it goes live
 * immediately instead of waiting for its cadence period. Kept as a template.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/openShortsRoundWindow.ts \
 *     --slug=one-button-game-2026-08-17 \
 *     --start=2026-08-16T00:00:00.000Z --end=2026-08-23T23:59:59.999Z
 */

import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { getPlayChallengeModel } from "../models/shorts/challenge.js";

const arg = (name: string) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : undefined;
};

async function main() {
  const slug = arg("slug");
  const start = arg("start");
  const end = arg("end");
  if (!slug || !start || !end || isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    console.error("Usage: openShortsRoundWindow.ts --slug=<slug> --start=<ISO> --end=<ISO>");
    process.exit(1);
  }

  await connectPlayMongoose();
  const Challenge = getPlayChallengeModel();
  const doc = await Challenge.findOneAndUpdate(
    { slug },
    { $set: { windowStartsAt: new Date(start), windowEndsAt: new Date(end) } },
    { new: true },
  );
  if (!doc) {
    console.error(`No challenge with slug ${slug}`);
    process.exit(1);
  }
  console.log(
    `✓ ${doc.slug} (${doc.challengeDate}, ${doc.status}) window: ` +
      `${doc.windowStartsAt?.toISOString()} → ${doc.windowEndsAt?.toISOString()}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
