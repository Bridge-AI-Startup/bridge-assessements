/**
 * Mic-level helpers for the pre-start voice check.
 *
 * The check exists to catch a mute switch or the wrong input — not to score
 * how clearly someone spoke. Time above the threshold therefore accumulates
 * across short gaps (the dip between "check" and "check" must not wipe
 * progress). The meter in AssessmentSetup is scaled to METER_RMS_FULL, so
 * SPEECH_RMS_THRESHOLD is the point at which that bar is obviously moving.
 */

/** RMS above this, on a -1..1 time-domain buffer, counts as the mic working. */
export const SPEECH_RMS_THRESHOLD = 0.025;

/** How long above-threshold audio must add up, including brief dips. */
export const SPEECH_HOLD_MS = 280;

/** VoiceLevelMeter reaches 100% at this RMS. Keep in lockstep with the UI. */
export const METER_RMS_FULL = 0.18;

/**
 * @param {ArrayLike<number>} bytes 0–255 time-domain samples
 * @returns {number}
 */
export function rmsFromTimeDomain(bytes) {
  if (!bytes?.length) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

/**
 * @param {number} heardMs
 * @param {number} rms
 * @param {number} dt
 * @returns {number}
 */
export function advanceSpeechHold(heardMs, rms, dt) {
  if (!(dt > 0)) return heardMs;
  if (rms >= SPEECH_RMS_THRESHOLD) return heardMs + dt;
  return heardMs;
}

export function speechHoldReached(heardMs) {
  return heardMs >= SPEECH_HOLD_MS;
}
