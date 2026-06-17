/**
 * Results + evidence persistence. Writes the machine-readable results.json that
 * the DemoReadiness.canvas.tsx sheet consumes, plus a flat evidence directory
 * for screenshots and raw artifacts.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import type { SuiteResults } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RESULTS_DIR = path.resolve(__dirname, "../../results");
export const EVIDENCE_DIR = path.join(RESULTS_DIR, "evidence");
export const RESULTS_FILE = path.join(RESULTS_DIR, "results.json");

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
}

export async function writeResults(results: SuiteResults): Promise<string> {
  await ensureDirs();
  await fs.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2), "utf-8");
  return RESULTS_FILE;
}

export async function readResults(): Promise<SuiteResults | null> {
  try {
    const raw = await fs.readFile(RESULTS_FILE, "utf-8");
    return JSON.parse(raw) as SuiteResults;
  } catch {
    return null;
  }
}

/** Save an evidence artifact (e.g. a transcript dump) and return its path. */
export async function saveEvidenceFile(
  name: string,
  data: Buffer | string
): Promise<string> {
  await ensureDirs();
  const p = path.join(EVIDENCE_DIR, name);
  await fs.writeFile(p, data);
  return p;
}

/** Repo-relative path (for embedding in the canvas / README). */
export function repoRelative(absPath: string): string {
  const repoRoot = path.resolve(__dirname, "../../../../");
  return path.relative(repoRoot, absPath);
}
