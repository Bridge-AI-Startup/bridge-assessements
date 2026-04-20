/**
 * One-time migration: copy all files under PROCTORING_STORAGE_DIR into the configured S3 bucket
 * using the same relative paths as object keys (matches MongoDB storageKey values).
 *
 * Usage (from server/, with AWS env + bucket set — same as runtime S3 config):
 *   npx tsx src/scripts/migrateProctoringLocalToS3.ts --dry-run
 *   npx tsx src/scripts/migrateProctoringLocalToS3.ts
 *
 * Optional: --source=/absolute/path/to/proctoring  (defaults to PROCTORING_STORAGE_DIR or ./storage/proctoring)
 */

import "../config/loadEnv.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function contentTypeForKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".jsonl")) return "application/x-ndjson";
  return undefined;
}

async function walkFiles(
  dir: string,
  baseDir: string
): Promise<Array<{ key: string; absPath: string }>> {
  const out: Array<{ key: string; absPath: string }> = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkFiles(abs, baseDir)));
    } else if (ent.isFile()) {
      const rel = path.relative(baseDir, abs);
      const key = rel.split(path.sep).join("/");
      out.push({ key, absPath: abs });
    }
  }
  return out;
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  source: string | null;
} {
  let dryRun = false;
  let source: string | null = null;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    if (a.startsWith("--source=")) source = a.slice("--source=".length);
  }
  return { dryRun, source };
}

async function main() {
  const { dryRun, source } = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`migrateProctoringLocalToS3 — copy local proctoring files to S3

Options:
  --dry-run          List actions only
  --source=DIR       Local root (default: PROCTORING_STORAGE_DIR or ./storage/proctoring)

Requires: PROCTORING_S3_BUCKET or AWS_S3_BUCKET, AWS_REGION, AWS credentials
`);
    process.exit(0);
  }

  const bucket =
    process.env.PROCTORING_S3_BUCKET?.trim() || process.env.AWS_S3_BUCKET?.trim();
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!bucket || !region) {
    console.error("Set PROCTORING_S3_BUCKET (or AWS_S3_BUCKET) and AWS_REGION.");
    process.exit(1);
  }

  const baseDir = path.resolve(
    source ||
      process.env.PROCTORING_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "proctoring")
  );

  await fs.access(baseDir).catch(() => {
    console.error(`Source directory not found: ${baseDir}`);
    process.exit(1);
  });

  const files = await walkFiles(baseDir, baseDir);
  console.log(`Source: ${baseDir}\nBucket: ${bucket} (${region})\nFiles: ${files.length}${dryRun ? " [dry-run]" : ""}`);

  const client = new S3Client({ region });
  let uploaded = 0;
  for (const { key, absPath } of files) {
    if (dryRun) {
      console.log(`  would put: ${key}`);
      continue;
    }
    const body = await fs.readFile(absPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeForKey(key),
      })
    );
    uploaded++;
    if (uploaded % 100 === 0) console.log(`  uploaded ${uploaded}/${files.length}...`);
  }
  console.log(dryRun ? "Dry-run done." : `Done. Uploaded ${uploaded} object(s).`);
}

const scriptPath = fileURLToPath(import.meta.url);
const invokedAsMain =
  process.argv[1] &&
  path.resolve(scriptPath) === path.resolve(process.argv[1]);

if (invokedAsMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
