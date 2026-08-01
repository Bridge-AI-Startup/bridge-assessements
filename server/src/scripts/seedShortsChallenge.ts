/**
 * Upsert a Play challenge from a JSON file.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/seedShortsChallenge.ts [path-to-json]
 *
 * Defaults to ../play/challenges/counter-widget.json relative to server/.
 * If challengeDate is omitted, uses the current period key from
 * PLAY_CHALLENGE_CADENCE (weekly default → Monday UTC; daily → today UTC).
 */

import "../config/loadEnv.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import connectPlayMongoose from "../db/shortsConnection.js";
import {
  getUtcChallengeDate,
  createChallenge,
  updateChallenge,
  getChallengeBySlug,
} from "../services/shorts/challenges.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SeedPayload = {
  slug: string;
  challengeDate?: string;
  title: string;
  prompt: string;
  tokenBudget: number;
  timeLimitMinutes?: number;
  category: "widget" | "game" | "tool" | "other";
  status?: "draft" | "published";
};

async function main() {
  const defaultPath = path.resolve(
    __dirname,
    "../../../play/challenges/counter-widget.json",
  );
  const jsonPath = path.resolve(process.argv[2] || defaultPath);

  if (!fs.existsSync(jsonPath)) {
    console.error("File not found:", jsonPath);
    console.error(
      "Usage: npx tsx src/scripts/seedShortsChallenge.ts [path-to-json]",
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  const payload = JSON.parse(raw) as SeedPayload;

  if (!payload.slug || !payload.title || !payload.prompt || !payload.tokenBudget) {
    console.error("JSON must include slug, title, prompt, and tokenBudget");
    process.exit(1);
  }

  const challengeDate = payload.challengeDate ?? getUtcChallengeDate();

  await connectPlayMongoose();

  const existing = await getChallengeBySlug(payload.slug);
  let doc;

  if (existing) {
    doc = await updateChallenge(payload.slug, {
      challengeDate,
      title: payload.title,
      prompt: payload.prompt,
      tokenBudget: payload.tokenBudget,
      timeLimitMinutes: payload.timeLimitMinutes,
      category: payload.category,
      status: payload.status ?? "draft",
    });
    console.log("Challenge updated:");
  } else {
    doc = await createChallenge({
      slug: payload.slug,
      challengeDate,
      title: payload.title,
      prompt: payload.prompt,
      tokenBudget: payload.tokenBudget,
      timeLimitMinutes: payload.timeLimitMinutes,
      category: payload.category,
      status: payload.status ?? "draft",
    });
    console.log("Challenge created:");
  }

  console.log("  slug:", doc.slug);
  console.log("  challengeDate:", doc.challengeDate);
  console.log("  status:", doc.status);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
