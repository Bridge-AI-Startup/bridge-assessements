const STORAGE_KEY = "playDisplayName";
const MIN_LEN = 1;
const MAX_LEN = 40;

/** Read saved Play display name from localStorage (trimmed, 1–40 chars). */
export function getDisplayName() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing == null) return "";
    const trimmed = existing.trim();
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return "";
    return trimmed;
  } catch {
    return "";
  }
}

/** Persist display name. Returns true if stored. */
export function setDisplayName(name) {
  const trimmed = String(name ?? "").trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) {
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

export function isValidDisplayName(name) {
  const trimmed = String(name ?? "").trim();
  return trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;
}

export const DISPLAY_NAME_MAX = MAX_LEN;
