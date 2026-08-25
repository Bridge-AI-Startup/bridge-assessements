/**
 * Manually switch the current Shorts round.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/activateShortsRound.ts \
 *     --slug=one-button-game-2026-08-17
 *
 * Publishing a challenge does not activate it. The selected round remains
 * current until this script or the Admin "Make current round" button activates
 * another published challenge.
 */
import "../config/loadEnv.js";
import connectPlayMongoose from "../db/shortsConnection.js";
import { activateChallenge } from "../services/shorts/challenges.js";

const slug = process.argv
  .find((value) => value.startsWith("--slug="))
  ?.slice("--slug=".length)
  .trim();

async function main() {
  if (!slug) {
    console.error("Usage: activateShortsRound.ts --slug=<published-challenge-slug>");
    process.exit(1);
  }

  await connectPlayMongoose();
  const challenge = await activateChallenge(slug);
  console.log(
    `✓ Current Shorts round: ${challenge.slug} (${challenge.challengeDate})`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
