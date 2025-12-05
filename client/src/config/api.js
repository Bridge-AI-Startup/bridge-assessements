/**
 * Backend API configuration
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5050";

export const API_ENDPOINTS = {
  // User Auth endpoints
  USER_AUTH: {
    CREATE: `${API_BASE_URL}/api/user-auth/create`,
    LOGIN: `${API_BASE_URL}/api/user-auth/login`,
    ME: `${API_BASE_URL}/api/user-auth/me`,
    UPDATE_ME: `${API_BASE_URL}/api/user-auth/me`,
  },
  // Auth endpoints
  AUTH: {
    VERIFY: `${API_BASE_URL}/api/auth/verify`,
    USER: `${API_BASE_URL}/api/auth/user`,
  },
};
