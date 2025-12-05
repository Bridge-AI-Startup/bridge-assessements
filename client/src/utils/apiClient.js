import { getIdToken } from "@/auth";

/**
 * Make an authenticated API request
 * Automatically includes Firebase ID token in Authorization header
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export const authenticatedFetch = async (url, options = {}) => {
  try {
    // Get Firebase ID token
    const token = await getIdToken();

    // Merge headers
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };

    // Make request with token
    const response = await fetch(url, {
      ...options,
      headers,
    });

    return response;
  } catch (error) {
    console.error("API request error:", error);
    throw error;
  }
};

/**
 * Make an authenticated GET request
 */
export const authenticatedGet = async (url, options = {}) => {
  return authenticatedFetch(url, {
    ...options,
    method: "GET",
  });
};

/**
 * Make an authenticated POST request
 */
export const authenticatedPost = async (url, data, options = {}) => {
  return authenticatedFetch(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
};

/**
 * Make an authenticated PATCH request
 */
export const authenticatedPatch = async (url, data, options = {}) => {
  return authenticatedFetch(url, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

/**
 * Make an authenticated DELETE request
 */
export const authenticatedDelete = async (url, options = {}) => {
  return authenticatedFetch(url, {
    ...options,
    method: "DELETE",
  });
};
