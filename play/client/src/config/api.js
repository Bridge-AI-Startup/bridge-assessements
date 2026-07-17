/**
 * Play API configuration — routes live under /api/play on the shared backend.
 */
const BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.MODE === "development"
    ? "http://localhost:5050"
    : "https://bridge-assessements-1.onrender.com");

export const API_BASE_URL = `${BASE_URL}/api/play`;
