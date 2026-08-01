/**
 * Shorts API configuration — routes live under /api/shorts on the shared
 * backend. The server also keeps a legacy `/api/play` alias for older clients.
 */
const BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.MODE === "development"
    ? "http://localhost:5050"
    : "https://bridge-assessements-1.onrender.com");

export const API_BASE_URL = `${BASE_URL}/api/shorts`;
