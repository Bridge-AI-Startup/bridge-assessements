const STORAGE_KEY = "playBuildLayout.v1";

/** @typedef {"chat" | "studio"} BuildLayoutMode */

/** @returns {BuildLayoutMode} */
export function loadBuildLayoutMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "studio" || raw === "chat") return raw;
  } catch {
    // ignore
  }
  return "chat";
}

/** @param {BuildLayoutMode} mode */
export function saveBuildLayoutMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
