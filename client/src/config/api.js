/**
 * Backend API configuration
 * This is the single source of truth for the API base URL.
 *
 * Behavior:
 * - If VITE_API_URL is set, it takes priority
 * - In development mode (npm run dev), defaults to http://localhost:5050
 * - In production mode (npm run build), defaults to Render backend
 */
// @ts-expect-error - import.meta.env is provided by Vite at build time
const BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.MODE === "development"
    ? "http://localhost:5050"
    : "https://bridge-assessements.onrender.com");

// Export the base URL with /api prefix (as all backend routes are under /api)
export const API_BASE_URL = `${BASE_URL}/api`;

export const API_ENDPOINTS = {
  // User Auth endpoints
  USER_AUTH: {
    CREATE: `${API_BASE_URL}/user-auth/create`,
    LOGIN: `${API_BASE_URL}/user-auth/login`,
    ME: `${API_BASE_URL}/user-auth/me`,
    UPDATE_ME: `${API_BASE_URL}/user-auth/me`,
  },
};
