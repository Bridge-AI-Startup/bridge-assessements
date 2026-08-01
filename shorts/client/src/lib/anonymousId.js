const STORAGE_KEY = "playAnonymousId";

function createUuidV4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Held in memory so that when localStorage is unavailable (Safari private
// mode, blocked storage, some webviews) every caller in a page load still
// shares one id. Without this each call minted a new UUID, so a session
// created as one identity was rejected (403) by the next request.
let cachedId = null;

/** Get or create a stable anonymous id in localStorage. */
export function getOrCreateAnonymousId() {
  if (cachedId) return cachedId;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) {
      cachedId = existing;
      return cachedId;
    }
    const id = createUuidV4();
    localStorage.setItem(STORAGE_KEY, id);
    cachedId = id;
    return cachedId;
  } catch {
    // Stable for this page load only — the build will not survive a refresh.
    cachedId = createUuidV4();
    return cachedId;
  }
}
