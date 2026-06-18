/**
 * Builds starterCodeFiles JSON for Bridge Assessment document (max 50 files, 1MB total).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const REL_PATHS = [
  "README.md",
  "CHALLENGE.md",
  ".gitignore",
  "server/package.json",
  "server/tsconfig.json",
  "server/config.env",
  "server/config.env.example",
  "server/src/server.ts",
  "server/src/store.ts",
  "server/src/types.ts",
  "server/src/routes/tickets.ts",
  "server/tests/tickets.test.ts",
  "client/package.json",
  "client/vite.config.js",
  "client/index.html",
  "client/.env.example",
  "client/.env.local",
  "client/src/main.jsx",
  "client/src/App.jsx",
  "client/src/api.js",
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

const outPath = path.join(__dirname, "starter-files.embedded.json");
fs.writeFileSync(outPath, JSON.stringify(files));
console.error("Wrote", outPath);
process.stdout.write(JSON.stringify({ fileCount: files.length, totalBytes: total }));
