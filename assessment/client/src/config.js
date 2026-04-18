const raw = import.meta.env.VITE_API_URL || "http://localhost:5060/api";
export const API_BASE_URL = raw.replace(/\/$/, "");
