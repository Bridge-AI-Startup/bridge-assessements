/**
 * Central config + budgets for the E2E suite. All knobs are env-overridable so
 * the suite can be tuned for CI vs. local without code changes.
 */

export const API_BASE_URL =
  process.env.E2E_API_BASE_URL || `http://localhost:${process.env.PORT || 5050}`;

/** Firebase Web API key (public; mirrors client/src/firebase/firebase.js). */
export const FIREBASE_WEB_API_KEY =
  process.env.E2E_FIREBASE_WEB_API_KEY ||
  "AIzaSyCjMiRlX0HERCvA4qv0o1MO7fM5mzkdkCo";

/** Unique tag so every artifact this run creates is identifiable + cleanable. */
export const RUN_ID = process.env.E2E_RUN_ID || `${Date.now()}`;

/** All test users share this domain so cleanup can target them safely. */
export const TEST_EMAIL_DOMAIN = "bridge-e2e.test";

export function testEmail(suffix = ""): string {
  return `e2e+${RUN_ID}${suffix}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Hard wall-clock budgets (ms). These are the "counter terminal jams" guard:
 * no single step is allowed to run unbounded. Tunable via env.
 */
export const BUDGETS = {
  apiCall: numEnv("E2E_BUDGET_API_MS", 30_000),
  authFlow: numEnv("E2E_BUDGET_AUTH_MS", 30_000),
  assessmentGen: numEnv("E2E_BUDGET_ASSESSMENT_MS", 120_000),
  indexRepo: numEnv("E2E_BUDGET_INDEX_MS", 180_000),
  transcript: numEnv("E2E_BUDGET_TRANSCRIPT_MS", 180_000),
  videoMerge: numEnv("E2E_BUDGET_MERGE_MS", 120_000),
  scoring: numEnv("E2E_BUDGET_SCORING_MS", 180_000),
};

/**
 * Fixture sizing — deliberately small so we never analyze a 30-minute video.
 * The "large input" guard test multiplies these to prove the cap works.
 */
export const FIXTURES = {
  syntheticFrameCount: numEnv("E2E_FRAME_COUNT", 4),
  frameWidth: numEnv("E2E_FRAME_W", 640),
  frameHeight: numEnv("E2E_FRAME_H", 400),
  realRecordingSeconds: numEnv("E2E_REAL_CLIP_SECONDS", 6),
  /** Anything above this many frames is considered "too long to run inline". */
  maxInlineFrames: numEnv("E2E_MAX_INLINE_FRAMES", 40),
};

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
