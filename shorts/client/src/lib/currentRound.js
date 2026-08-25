import { get } from "@/api/requests";

let cached = null;
let inflight = null;

export function invalidateCurrentRound() {
  cached = null;
  inflight = null;
}

/** Fetch the manually selected current round key. */
export async function fetchCurrentRound() {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await get("/round");
      if (res.status === 404) {
        cached = { challengeDate: "", label: "No active round" };
        return cached;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      cached = {
        challengeDate: String(body.challengeDate || ""),
        label: "This round",
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

