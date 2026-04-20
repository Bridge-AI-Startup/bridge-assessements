/**
 * Quick sanity check for transcript checkpoint fingerprinting (no network, no DB).
 * Run: cd server && npx tsx src/scripts/verifyTranscriptCheckpoint.ts
 */
import assert from "node:assert/strict";
import { computeTranscriptFingerprint } from "../ai/transcript/transcriptCheckpoint.js";

const baseOpts = {
  regionDetection: false,
  batchSize: 2,
  regionBatchSize: 5,
  layoutRedetectInterval: 90,
};

const framesA = [{ storageKey: "s/f1.png" } as { storageKey: string }];
const framesB = [{ storageKey: "s/f2.png" } as { storageKey: string }];

const fp1 = computeTranscriptFingerprint(framesA as any, baseOpts);
const fp2 = computeTranscriptFingerprint(framesB as any, baseOpts);
assert.notEqual(fp1, fp2);

const fp1b = computeTranscriptFingerprint(framesA as any, baseOpts);
assert.equal(fp1, fp1b);

const fpRegion = computeTranscriptFingerprint(framesA as any, {
  ...baseOpts,
  regionDetection: true,
});
assert.notEqual(fp1, fpRegion);

console.log("verifyTranscriptCheckpoint: ok");
