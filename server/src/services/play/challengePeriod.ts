/**
 * Play challenge cadence: one published challenge per period.
 *
 * Switch with env (no code change):
 *   PLAY_CHALLENGE_CADENCE=weekly  (default)
 *   PLAY_CHALLENGE_CADENCE=daily
 *
 * Period key is still stored as `challengeDate` (YYYY-MM-DD):
 *   daily  → that UTC calendar day
 *   weekly → Monday UTC of the ISO-style week (Mon–Sun)
 */

export type PlayChallengeCadence = "daily" | "weekly";

export function getPlayChallengeCadence(): PlayChallengeCadence {
  const raw = (process.env.PLAY_CHALLENGE_CADENCE || "weekly")
    .trim()
    .toLowerCase();
  return raw === "daily" ? "daily" : "weekly";
}

/** Monday UTC (YYYY-MM-DD) for the week containing `date`. */
export function getUtcWeekStartDate(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const dayOfMonth = date.getUTCDate();
  const dow = date.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(Date.UTC(y, m, dayOfMonth + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

/** Current period key used to look up the live challenge. */
export function getCurrentPeriodKey(date: Date = new Date()): string {
  if (getPlayChallengeCadence() === "daily") {
    return date.toISOString().slice(0, 10);
  }
  return getUtcWeekStartDate(date);
}

/**
 * Inclusive end of the challenge period for a stored `challengeDate` / period key.
 * Weekly: week containing that date (Mon 00:00 → Sun 23:59:59.999Z).
 */
export function endOfChallengePeriod(
  periodKey: string,
  cadence: PlayChallengeCadence = getPlayChallengeCadence(),
): Date {
  if (cadence === "daily") {
    return new Date(`${periodKey}T23:59:59.999Z`);
  }
  const weekStart = getUtcWeekStartDate(
    new Date(`${periodKey}T12:00:00.000Z`),
  );
  const [y, m, d] = weekStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 6, 23, 59, 59, 999));
}

export type ChallengePeriodInfo = {
  cadence: PlayChallengeCadence;
  periodKey: string;
  periodEndsAt: string;
  /** Short UI copy, e.g. "This week" / "Today" */
  label: string;
};

export function getChallengePeriodInfo(
  date: Date = new Date(),
): ChallengePeriodInfo {
  const cadence = getPlayChallengeCadence();
  const periodKey = getCurrentPeriodKey(date);
  const periodEndsAt = endOfChallengePeriod(periodKey, cadence).toISOString();
  return {
    cadence,
    periodKey,
    periodEndsAt,
    label: cadence === "weekly" ? "This week" : "Today",
  };
}
