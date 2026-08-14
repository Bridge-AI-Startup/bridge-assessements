/**
 * Builds the grading-eval fixture archives.
 *
 * A variant is the shared base project plus a small overlay, so the only
 * difference between "correct" and "broken" is the file that was deliberately
 * changed. The archive is stored through the same submission-code storage the
 * real upload path uses, which is why grading needs no GitHub repo to run.
 */

import archiver from "archiver";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { PassThrough } from "stream";
import { fileURLToPath } from "url";

import type { FixtureVariant } from "./expectations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_ROOT = path.resolve(__dirname, "../grading-fixtures/notes-api");
const BASE_DIR = path.join(FIXTURE_ROOT, "base");
const VARIANTS_DIR = path.join(FIXTURE_ROOT, "variants");

export type FixtureArchive = {
  variant: FixtureVariant;
  buffer: Buffer;
  sha256: string;
  files: string[];
};

async function readDirRecursive(dir: string, prefix = ""): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await readDirRecursive(abs, rel)) out.set(k, v);
    } else if (entry.isFile()) {
      out.set(rel, await fs.readFile(abs));
    }
  }
  return out;
}

/**
 * Compose base + overlay. `complete` has no overlay directory — it is the base
 * implementation, which keeps the reference variant honest: it cannot drift from
 * the files the broken variants are derived from.
 */
export async function buildFixtureArchive(
  variant: FixtureVariant
): Promise<FixtureArchive> {
  const files = await readDirRecursive(BASE_DIR);
  if (files.size === 0) {
    throw new Error(`Fixture base directory is empty or missing: ${BASE_DIR}`);
  }

  if (variant !== "complete") {
    const overlay = await readDirRecursive(path.join(VARIANTS_DIR, variant));
    if (overlay.size === 0) {
      throw new Error(
        `Variant overlay is empty or missing: ${path.join(VARIANTS_DIR, variant)}`
      );
    }
    for (const [name, content] of overlay) files.set(name, content);
  }

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });
    const sink = new PassThrough();
    sink.on("data", (c: Buffer) => chunks.push(c));
    sink.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.pipe(sink);
    for (const [name, content] of files) archive.append(content, { name });
    archive.finalize().catch(reject);
  });

  return {
    variant,
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    files: [...files.keys()].sort(),
  };
}
