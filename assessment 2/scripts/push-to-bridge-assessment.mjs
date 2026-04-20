/**
 * Updates the Bridge Assessment document with full description (CHALLENGES) + starterCodeFiles.
 * Usage (from repo root):
 *   node assessment/scripts/push-to-bridge-assessment.mjs
 * Requires MONGODB_URI or ATLAS_URI in env, or server/config.env with ATLAS_URI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const require = createRequire(import.meta.url);
const mongodb = require(path.join(repoRoot, "server/node_modules/mongodb"));
const { MongoClient, ObjectId } = mongodb;
const assessmentRoot = path.resolve(__dirname, "..");

const ASSESSMENT_ID = process.env.BRIDGE_ASSESSMENT_ID || "69e2f6363d67909e5af9d1f0";
const DB_NAME = process.env.DB_NAME || "bridge-assessments";

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2].replace(/^["']|["']$/g, "").trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile(path.join(repoRoot, "server/config.env"));
loadEnvFile(path.join(repoRoot, "server/config.env.local"));

const uri = process.env.MONGODB_URI || process.env.ATLAS_URI;
if (!uri) {
  console.error("Set ATLAS_URI or MONGODB_URI, or create server/config.env with ATLAS_URI.");
  process.exit(1);
}

const challengesPath = path.join(assessmentRoot, "challenge.md");
const starterJsonPath = path.join(__dirname, "starter-files.embedded.json");

const challenges = fs.readFileSync(challengesPath, "utf8");
const starterCodeFiles = JSON.parse(fs.readFileSync(starterJsonPath, "utf8"));

const description = [
  "Work in the **starter code** package below (same layout as the `assessment/` folder in the Bridge monorepo).",
  "Unzip or copy files into a workspace, run `server` + `client` per README.",
  "",
  "---",
  "",
  challenges.trimEnd(),
  "",
].join("\n");

const client = new MongoClient(uri);
await client.connect();
const col = client.db(DB_NAME).collection("assessments");
const r = await col.updateOne(
  { _id: new ObjectId(ASSESSMENT_ID) },
  {
    $set: {
      description,
      starterCodeFiles,
      updatedAt: new Date(),
    },
  },
);
console.log("matched:", r.matchedCount, "modified:", r.modifiedCount);
if (r.matchedCount === 0) {
  console.error("No assessment with _id", ASSESSMENT_ID);
  process.exit(1);
}
await client.close();
