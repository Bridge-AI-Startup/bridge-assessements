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

/** Get or create a stable anonymous id in localStorage. */
export function getOrCreateAnonymousId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) {
      return existing;
    }
    const id = createUuidV4();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return createUuidV4();
  }
}
