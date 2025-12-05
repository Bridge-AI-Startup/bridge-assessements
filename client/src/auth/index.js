// Export all auth services
export * from "./service.js";
export * from "./utils.js";
export { auth, analytics } from "./firebase.js";
export { default as firebaseApp } from "./firebase.js";

// Export backend API config
export { API_BASE_URL, API_ENDPOINTS } from "@/config/api.js";
