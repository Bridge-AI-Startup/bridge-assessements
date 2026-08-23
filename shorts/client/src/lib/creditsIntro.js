import { getOrCreateAnonymousId } from "@/lib/anonymousId";

/** DOM id on the header credits gauge — the kickoff arrow targets this. */
export const CREDITS_METER_ID = "shorts-credits-meter";

const STORAGE_PREFIX = "shortsCreditsIntro.v2";

function storageKey({ signedIn, uid, anonymousId }) {
  if (signedIn && uid) return `${STORAGE_PREFIX}.account.${uid}`;
  const anon = anonymousId || getOrCreateAnonymousId();
  return `${STORAGE_PREFIX}.guest.${anon}`;
}

/** @param {{ signedIn?: boolean, uid?: string | null, anonymousId?: string }} identity */
export function hasSeenCreditsIntro(identity) {
  try {
    return localStorage.getItem(storageKey(identity)) === "1";
  } catch {
    return false;
  }
}

/** @param {{ signedIn?: boolean, uid?: string | null, anonymousId?: string }} identity */
export function markCreditsIntroSeen(identity) {
  try {
    localStorage.setItem(storageKey(identity), "1");
  } catch {
    /* private mode */
  }
}
