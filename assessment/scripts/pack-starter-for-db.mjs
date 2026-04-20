/**
 * Builds starterCodeFiles JSON for Bridge Assessment document (max 50 files, 1MB total per server validation).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const REL_PATHS = [
  "README.md",
  "challenge.md",
  ".gitignore",
  "server/package.json",
  "server/tsconfig.json",
  "server/config.env.example",
  "server/src/server.ts",
  "server/src/db.ts",
  "server/src/seed.ts",
  "server/src/routes/index.ts",
  "server/src/middleware/auth.ts",
  "server/src/utils/token.ts",
  "server/src/models/user.ts",
  "server/src/models/assessment.ts",
  "server/src/models/submission.ts",
  "server/src/validators/assessment.ts",
  "server/src/validators/submission.ts",
  "server/src/controllers/user.ts",
  "server/src/controllers/assessment.ts",
  "server/src/controllers/submission.ts",
  "client/package.json",
  "client/vite.config.js",
  "client/index.html",
  "client/.env.example",
  "client/src/main.jsx",
  "client/src/App.jsx",
  "client/src/Employer.jsx",
  "client/src/Candidate.jsx",
  "client/src/api.js",
  "client/src/config.js",
  "client/src/index.css",
];

const files = [];
let total = 0;
for (const rel of REL_PATHS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error("Missing:", rel);
    process.exit(1);
  }
  const content = fs.readFileSync(abs, "utf8");
  total += Buffer.byteLength(content, "utf8");
  files.push({ path: rel.replace(/\\/g, "/"), content });
}

console.error("Files:", files.length, "total bytes:", total);
if (files.length > 50) process.exit(1);
if (total > 1024 * 1024) process.exit(2);

process.stdout.write(JSON.stringify(files));
