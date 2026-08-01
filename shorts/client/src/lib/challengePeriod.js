import { get } from "@/api/requests";

let cached = null;
let inflight = null;

/**
 * @returns {Promise<{
 *   cadence: "daily" | "weekly",
 *   periodKey: string,
 *   periodEndsAt: string,
 *   label: string,
 * }>}
 */
export async function fetchChallengePeriod() {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await get("/period");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      cached = {
        cadence: body.cadence === "daily" ? "daily" : "weekly",
        periodKey: String(body.periodKey || ""),
        periodEndsAt: String(body.periodEndsAt || ""),
        label: String(body.label || (body.cadence === "daily" ? "Today" : "This week")),
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function periodPossessive(cadence) {
  return cadence === "weekly" ? "this week's" : "today's";
}

export function periodNoun(cadence) {
  return cadence === "weekly" ? "week" : "day";
}
