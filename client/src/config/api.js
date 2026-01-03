/**
 * Backend API configuration
 * This is the single source of truth for the API base URL.
 * Set VITE_API_URL environment variable to override the default.
 */
// @ts-expect-error - import.meta.env is provided by Vite at build time
const BASE_URL =
  import.meta.env.VITE_API_URL || "https://bridge-assessements.onrender.com";

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
