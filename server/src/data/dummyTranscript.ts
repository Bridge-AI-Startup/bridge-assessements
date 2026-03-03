import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { TranscriptEvent } from "../types/evaluation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const samplePath = path.join(
  __dirname,
  "../scripts/evals/transcripts/sample_two_sum.json"
);

const raw = readFileSync(samplePath, "utf-8");
const parsed = JSON.parse(raw) as TranscriptEvent[];

export const dummyScreenRecordingTranscript: TranscriptEvent[] = parsed;
