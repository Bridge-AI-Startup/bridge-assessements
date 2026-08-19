import { describe, expect, it } from "vitest";

import {
  SPEECH_HOLD_MS,
  SPEECH_RMS_THRESHOLD,
  advanceSpeechHold,
  rmsFromTimeDomain,
  speechHoldReached,
} from "../../../client/src/lib/micLevel.js";

/** The hold logic this replaced: dips below threshold wiped progress 1:1. */
function decayingHold(heardMs: number, rms: number, dt: number) {
  if (rms >= 0.05) return heardMs + dt;
  return Math.max(0, heardMs - dt);
}

describe("micLevel", () => {
  it("treats a centered byte buffer as silence", () => {
    expect(rmsFromTimeDomain(new Uint8Array(2048).fill(128))).toBe(0);
  });

  it("counts two short spoken bursts across a gap — the 'check, check' case", () => {
    // The setup copy tells people "Check, check" is fine. Each word is a
    // ~150ms burst with a gap in between. The bar moves on each burst; the
    // old decay reset heardMs in the gap so the check never passed.
    const speech = SPEECH_RMS_THRESHOLD + 0.01;
    let heardMs = 0;
    let decaying = 0;

    heardMs = advanceSpeechHold(heardMs, speech, 150);
    decaying = decayingHold(decaying, speech, 150);
    heardMs = advanceSpeechHold(heardMs, 0.008, 120);
    decaying = decayingHold(decaying, 0.008, 120);
    heardMs = advanceSpeechHold(heardMs, speech, 150);
    decaying = decayingHold(decaying, speech, 150);

    expect(speechHoldReached(decaying)).toBe(false);
    expect(heardMs).toBe(300);
    expect(speechHoldReached(heardMs)).toBe(true);
  });

  it("does not pass on a click or a mute-switch noise spike", () => {
    let heardMs = 0;
    heardMs = advanceSpeechHold(heardMs, 0.4, 30);
    heardMs = advanceSpeechHold(heardMs, 0, 250);
    expect(speechHoldReached(heardMs)).toBe(false);
    expect(heardMs).toBe(30);
  });

  it("does not count meter flicker below the pass threshold", () => {
    let heardMs = 0;
    heardMs = advanceSpeechHold(heardMs, SPEECH_RMS_THRESHOLD - 0.001, SPEECH_HOLD_MS);
    expect(heardMs).toBe(0);
    expect(speechHoldReached(heardMs)).toBe(false);
  });
});
